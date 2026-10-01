//! Compose "composition": build one compose file from several template slots.
//!
//! A *slot* is one template plus an optional instance name, so the same
//! template can appear more than once:
//!
//! ```text
//! [ {redis, cache_a}, {redis, cache_b}, {nginx} ]
//! ```
//!
//! # Naming rules
//!
//! A slot is *instance-scoped* when the user named it, or when its template is
//! used more than once. For those, every service, top-level resource and
//! parameter gains an `_<label>` / `-<label>` suffix so instances stay
//! independent. A slot used exactly once keeps its original names, which keeps
//! the common single-template case familiar.
//!
//! | Thing            | Instance-scoped          | Single use                        |
//! |------------------|--------------------------|-----------------------------------|
//! | service          | `<svc>-<label>`          | `<svc>`, or `<tpl>-<svc>` if taken |
//! | resource         | `<res>-<label>`          | `<res>`, or `<tpl>-<res>` if taken |
//! | parameter        | `<VAR>_<label>`          | `<VAR>`, or `<VAR>_<tpl>` if taken |
//!
//! Variables supplied by compose/docker (`COMPOSE_*`, `DOCKER_*`, `GISCO_*`)
//! are never renamed — they are resolved by the runtime, not the user. Anything
//! else, including a bare `STACK_NAME`, is an ordinary parameter the user is
//! free to set.
//!
//! Renaming a service or resource would silently break every reference to it,
//! so all intra-template references are rewritten: `depends_on`, `links`,
//! `volumes_from`, `network_mode: service:x`, `extends.service`, service-level
//! `networks`/`volumes`, and `${VAR}` occurrences anywhere in the body.
//!
//! `container_name` is never generated here and never rewritten. Compose derives
//! container names from the project and service on its own, and pinning one
//! prevents `--scale`; a `container_name` in a template is the user's own choice
//! to keep.
//!
//! Renames are reported back to the caller so the UI can show the user exactly
//! which names changed and which `.env` keys will be written.

use anyhow::{anyhow, bail, Result};
use serde::Serialize;
use serde_yaml::{Mapping, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

/// One template selected for the stack, optionally named.
#[derive(Clone, Debug, Serialize)]
pub struct Slot {
    pub template_id: String,
    pub instance: Option<String>,
}

/// Raw template content, supplied by the caller (the manager loads it).
#[derive(Clone, Debug)]
pub struct TemplateSource {
    pub id: String,
    pub raw: String,
}

/// What a single slot contributed to the merged compose file.
#[derive(Clone, Debug, Serialize)]
pub struct SlotPlan {
    pub template_id: String,
    pub instance: Option<String>,
    /// Label used for generated suffixes (the instance name, else the template id).
    pub label: String,
    /// True when this slot's names were suffixed to keep it independent.
    pub instance_scoped: bool,
    /// Final service names contributed by this slot.
    pub services: Vec<String>,
    /// original -> final, for services that were renamed.
    pub renamed_services: BTreeMap<String, String>,
    /// original -> final, for networks/volumes/configs/secrets that were renamed.
    pub renamed_resources: BTreeMap<String, String>,
    /// original -> final, for `${VAR}` references that were renamed.
    pub renamed_params: BTreeMap<String, String>,
    /// Final `${VAR}` names this slot's portion of the compose file references.
    /// These are the keys written to `.env` for this slot, after any
    /// cross-slot rewriting, so the UI can group inputs per template.
    pub params: Vec<String>,
}

/// A name clash between two slots that could not be resolved silently.
#[derive(Clone, Debug, Serialize)]
pub struct MergeConflict {
    pub kind: String,
    pub name: String,
    pub kept_from: String,
    pub conflict_from: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Composition {
    pub compose: String,
    pub slots: Vec<SlotPlan>,
    pub warnings: Vec<String>,
    pub conflicts: Vec<MergeConflict>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OnConflict {
    /// Refuse to auto-rename; report every clash so the user can rename.
    Error,
    /// Auto-rename the clashing slot using its template id.
    Rename,
}

impl OnConflict {
    pub fn parse(raw: &str) -> Self {
        match raw {
            "rename" => OnConflict::Rename,
            _ => OnConflict::Error,
        }
    }
}

/// Top-level maps whose entries are shared, named resources.
const RESOURCE_KINDS: [&str; 4] = ["networks", "volumes", "configs", "secrets"];

/// Variables resolved by compose/docker rather than the user. Renaming these
/// would break compose's own plumbing, such as `${COMPOSE_PROJECT_NAME}`.
fn is_auto_var(name: &str) -> bool {
    name.starts_with("COMPOSE_") || name.starts_with("DOCKER_") || name.starts_with("GISCO_")
}

fn sanitize_label(raw: &str) -> String {
    let mapped: String = raw
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let mut out = String::with_capacity(mapped.len());
    let mut last_dash = false;
    for c in mapped.chars() {
        if c == '-' {
            if !last_dash {
                out.push(c);
            }
            last_dash = true;
        } else {
            out.push(c);
            last_dash = false;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    let trimmed: String = trimmed.chars().take(40).collect();
    if trimmed.is_empty() {
        "tpl".to_string()
    } else {
        trimmed
    }
}

fn unique_name(base: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{}-{}", base, n);
        if !taken.contains(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

fn key_name(k: &Value) -> String {
    match k {
        Value::String(s) => s.clone(),
        other => serde_yaml::to_string(other)
            .unwrap_or_default()
            .trim()
            .to_string(),
    }
}

/// One lexical piece of a string that may contain `${VAR}` / `$VAR`.
enum Piece {
    Text(String),
    Var {
        name: String,
        /// Text up to and including the name (`$FOO` or `${FOO`).
        head: String,
        /// Remainder of the reference, e.g. `:-8080}`.
        tail: String,
    },
}

fn ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_'
}

fn ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Split text into literal runs and variable references.
///
/// `$$` is an escape and never yields a variable. `${VAR}` accepts anything up
/// to the closing brace, so `${VAR:-default}` and `${VAR:?err}` are recognised
/// just like `${VAR}`.
fn tokenize_params(text: &str) -> Vec<Piece> {
    let chars: Vec<char> = text.chars().collect();
    let mut pieces: Vec<Piece> = Vec::new();
    let mut literal = String::new();
    let mut i = 0usize;

    macro_rules! flush {
        () => {
            if !literal.is_empty() {
                pieces.push(Piece::Text(std::mem::take(&mut literal)));
            }
        };
    }

    while i < chars.len() {
        if chars[i] != '$' {
            literal.push(chars[i]);
            i += 1;
            continue;
        }
        // `$$` is an escaped literal dollar.
        if i + 1 < chars.len() && chars[i + 1] == '$' {
            literal.push('$');
            i += 2;
            continue;
        }
        if i + 1 < chars.len() && chars[i + 1] == '{' {
            let mut j = i + 2;
            let mut name = String::new();
            while j < chars.len() && ident_char(chars[j]) {
                name.push(chars[j]);
                j += 1;
            }
            if !name.is_empty() && ident_start(name.chars().next().unwrap()) {
                let mut k = j;
                while k < chars.len() && chars[k] != '}' {
                    k += 1;
                }
                if k < chars.len() {
                    flush!();
                    pieces.push(Piece::Var {
                        // Head stops before the closing brace; `tail` starts at it.
                        head: format!("${{{}", name),
                        name,
                        tail: chars[j..=k].iter().collect(),
                    });
                    i = k + 1;
                    continue;
                }
            }
            literal.push('$');
            i += 1;
            continue;
        }
        let mut j = i + 1;
        let mut name = String::new();
        while j < chars.len() && ident_char(chars[j]) {
            name.push(chars[j]);
            j += 1;
        }
        if !name.is_empty() && ident_start(name.chars().next().unwrap()) {
            flush!();
            pieces.push(Piece::Var {
                head: format!("${}", name),
                name,
                tail: String::new(),
            });
            i = j;
            continue;
        }
        literal.push('$');
        i += 1;
    }
    flush!();
    pieces
}

/// Collect `${VAR}` and `$VAR` references in order of first appearance,
/// skipping `$$` escapes. Mirrors `extractEnvVars` on the frontend.
pub fn scan_params(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for piece in tokenize_params(text) {
        if let Piece::Var { name, .. } = piece {
            if seen.insert(name.clone()) {
                out.push(name);
            }
        }
    }
    out
}

/// Rewrite variable names in a string using `map`, preserving surrounding
/// syntax such as `${VAR:-8080}`.
fn rewrite_params_in_str(s: &str, map: &BTreeMap<String, String>) -> String {
    if map.is_empty() {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    for piece in tokenize_params(s) {
        match piece {
            Piece::Text(t) => out.push_str(&t),
            Piece::Var { name, head, tail } => {
                match map.get(&name) {
                    Some(new) => {
                        // Replace only the name inside the original head.
                        let kept: String = head
                            .chars()
                            .take(head.chars().count() - name.chars().count())
                            .collect();
                        out.push_str(&kept);
                        out.push_str(new);
                    }
                    None => out.push_str(&head),
                }
                out.push_str(&tail);
            }
        }
    }
    out
}

/// Recursively rewrite `${VAR}` references in every string inside a value.
fn rewrite_params_in_value(v: &mut Value, map: &BTreeMap<String, String>) {
    match v {
        Value::String(s) => {
            *s = rewrite_params_in_str(s, map);
        }
        Value::Sequence(seq) => {
            for item in seq.iter_mut() {
                rewrite_params_in_value(item, map);
            }
        }
        Value::Mapping(m) => {
            for (_k, val) in m.iter_mut() {
                rewrite_params_in_value(val, map);
            }
        }
        _ => {}
    }
}

fn rename_seq_items(v: &mut Value, map: &BTreeMap<String, String>) {
    if let Value::Sequence(seq) = v {
        for item in seq.iter_mut() {
            if let Value::String(s) = item {
                if let Some(new) = map.get(s.as_str()) {
                    *s = new.clone();
                }
            }
        }
    }
}

fn rename_map_keys(m: &mut Mapping, map: &BTreeMap<String, String>) {
    if map.is_empty() {
        return;
    }
    let keys: Vec<Value> = m.keys().cloned().collect();
    for k in keys {
        let name = key_name(&k);
        if let Some(new) = map.get(&name) {
            if let Some(val) = m.remove(&k) {
                m.insert(Value::String(new.clone()), val);
            }
        }
    }
}

/// `links: ["db", "db:alias"]` — rename the service, keep the alias.
fn rewrite_link(s: &str, map: &BTreeMap<String, String>) -> String {
    match s.split_once(':') {
        Some((svc, alias)) => format!(
            "{}:{}",
            map.get(svc).map(String::as_str).unwrap_or(svc),
            alias
        ),
        None => map.get(s).cloned().unwrap_or_else(|| s.to_string()),
    }
}

/// `volumes_from: ["db"]` / `["service:db"]` / `["container:db"]`.
fn rewrite_volumes_from(s: &str, map: &BTreeMap<String, String>) -> String {
    for prefix in ["container:", "service:"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            return format!(
                "{}{}",
                prefix,
                map.get(rest).map(String::as_str).unwrap_or(rest)
            );
        }
    }
    map.get(s).cloned().unwrap_or_else(|| s.to_string())
}

/// Short volume syntax `source:/target[:mode]`. Option syntax (`type=bind,...`)
/// and absolute paths are left alone because they never appear in the rename map.
fn rewrite_short_volume(s: &str, map: &BTreeMap<String, String>) -> String {
    if s.is_empty() || s.starts_with('/') || s.starts_with('.') || s.contains('=') {
        return s.to_string();
    }
    match s.split_once(':') {
        Some((src, rest)) => format!(
            "{}:{}",
            map.get(src).map(String::as_str).unwrap_or(src),
            rest
        ),
        None => s.to_string(),
    }
}

/// Rewrite every intra-template reference to a renamed service or resource.
fn rewrite_service_refs(
    service: &mut Value,
    svc: &BTreeMap<String, String>,
    res: &BTreeMap<String, String>,
) {
    let Some(m) = service.as_mapping_mut() else {
        return;
    };

    // depends_on: sequence form and mapping form.
    if let Some(dep) = m.get_mut(Value::String("depends_on".into())) {
        match dep {
            Value::Sequence(_) => rename_seq_items(dep, svc),
            Value::Mapping(dm) => rename_map_keys(dm, svc),
            _ => {}
        }
    }

    if let Some(Value::Sequence(seq)) = m.get_mut(Value::String("links".into())) {
        for item in seq.iter_mut() {
            if let Value::String(s) = item {
                *s = rewrite_link(s, svc);
            }
        }
    }

    if let Some(Value::Sequence(seq)) = m.get_mut(Value::String("volumes_from".into())) {
        for item in seq.iter_mut() {
            if let Value::String(s) = item {
                *s = rewrite_volumes_from(s, svc);
            }
        }
    }

    if let Some(Value::String(nm)) = m.get_mut(Value::String("network_mode".into())) {
        if let Some(rest) = nm.strip_prefix("service:") {
            *nm = format!(
                "service:{}",
                svc.get(rest).map(String::as_str).unwrap_or(rest)
            );
        }
    }

    // Same-file `extends` only: `{file: ...}` points at another file.
    if let Some(Value::Mapping(ext)) = m.get_mut(Value::String("extends".into())) {
        if !ext.contains_key(Value::String("file".into())) {
            if let Some(Value::String(target)) = ext.get_mut(Value::String("service".into())) {
                if let Some(new) = svc.get(target.as_str()) {
                    *target = new.clone();
                }
            }
        }
    }

    if let Some(nets) = m.get_mut(Value::String("networks".into())) {
        match nets {
            Value::Sequence(_) => rename_seq_items(nets, res),
            Value::Mapping(nm) => rename_map_keys(nm, res),
            _ => {}
        }
    }

    if let Some(vols) = m.get_mut(Value::String("volumes".into())) {
        match vols {
            Value::Sequence(seq) => {
                for item in seq.iter_mut() {
                    match item {
                        Value::String(s) => *s = rewrite_short_volume(s, res),
                        Value::Mapping(vm) => {
                            if let Some(Value::String(src)) =
                                vm.get_mut(Value::String("source".into()))
                            {
                                if let Some(new) = res.get(src.as_str()) {
                                    *src = new.clone();
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            Value::Mapping(vm) => rename_map_keys(vm, res),
            _ => {}
        }
    }
}

/// Build one compose file from the given slots.
///
/// `sources` must contain an entry for every `Slot::template_id`.
pub fn compose(
    sources: &HashMap<String, TemplateSource>,
    slots: &[Slot],
    on_conflict: OnConflict,
) -> Result<Composition> {
    if slots.is_empty() {
        bail!("Select at least one template");
    }

    // Reject exact duplicates: two slots for the same (template, instance).
    let mut seen_slots: HashSet<(String, Option<String>)> = HashSet::new();
    for s in slots {
        let key = (s.template_id.clone(), s.instance.clone());
        if !seen_slots.insert(key) {
            let label = s.instance.clone().unwrap_or_else(|| s.template_id.clone());
            bail!(
                "Template '{}' is selected more than once as '{}'",
                s.template_id,
                label
            );
        }
    }

    // How many slots use each template? Repetition forces instance scoping.
    let mut usage: HashMap<String, usize> = HashMap::new();
    for s in slots {
        *usage.entry(s.template_id.clone()).or_default() += 1;
    }

    let mut warnings: Vec<String> = Vec::new();
    let mut conflicts: Vec<MergeConflict> = Vec::new();
    let mut plans: Vec<SlotPlan> = Vec::new();
    let mut slot_raws: Vec<String> = Vec::new();

    let mut out_services: Mapping = Mapping::new();
    let mut out_resources: HashMap<&'static str, Mapping> = HashMap::new();
    let mut out_extras: Mapping = Mapping::new();

    // name -> owning label, for collision detection.
    let mut taken_services: HashMap<String, String> = HashMap::new();
    let mut taken_resources: HashMap<(String, String), (Value, String)> = HashMap::new();
    let mut taken_params: HashMap<String, String> = HashMap::new();

    for slot in slots {
        let source = sources
            .get(&slot.template_id)
            .ok_or_else(|| anyhow!("Template '{}' not found", slot.template_id))?;

        let parsed: Value = serde_yaml::from_str(&source.raw)
            .map_err(|e| anyhow!("Template '{}' is not valid YAML: {}", source.id, e))?;
        let doc = match parsed {
            Value::Mapping(m) => m,
            Value::Null => Mapping::new(),
            _ => bail!(
                "Template '{}' must be a YAML mapping at the top level",
                source.id
            ),
        };

        let label = sanitize_label(slot.instance.as_deref().unwrap_or(&source.id));
        let repeated = usage.get(&source.id).copied().unwrap_or(0) > 1;
        let instance_scoped = repeated || slot.instance.is_some();

        // ---- decide service renames for this slot -------------------------
        let raw_services = match doc.get(Value::String("services".into())) {
            Some(Value::Mapping(m)) => m.clone(),
            Some(Value::Null) | None => Mapping::new(),
            Some(_) => bail!("Template '{}': 'services' must be a mapping", source.id),
        };

        let mut renamed_services: BTreeMap<String, String> = BTreeMap::new();
        let mut service_name_set: HashSet<String> = taken_services.keys().cloned().collect();

        for k in raw_services.keys() {
            let orig = key_name(k);
            let mut final_name = orig.clone();
            if instance_scoped {
                final_name = unique_name(&format!("{}-{}", orig, label), &service_name_set);
            } else if service_name_set.contains(&orig) {
                let owner = taken_services.get(&orig).cloned().unwrap_or_default();
                conflicts.push(MergeConflict {
                    kind: "service".into(),
                    name: orig.clone(),
                    kept_from: owner,
                    conflict_from: source.id.clone(),
                });
                if on_conflict == OnConflict::Error {
                    final_name = orig.clone(); // resolved below by bailing with the full list
                } else {
                    final_name = unique_name(&format!("{}-{}", label, orig), &service_name_set);
                }
            }
            service_name_set.insert(final_name.clone());
            if final_name != orig {
                renamed_services.insert(orig, final_name);
            }
        }

        // ---- decide resource renames for this slot -------------------------
        let mut renamed_resources: BTreeMap<String, String> = BTreeMap::new();
        for kind in RESOURCE_KINDS {
            let Some(Value::Mapping(entries)) = doc.get(Value::String(kind.into())) else {
                continue;
            };
            let mut reserved: HashSet<String> = taken_resources
                .keys()
                .filter(|(k, _)| k == kind)
                .map(|(_, n)| n.clone())
                .collect();
            for k in entries.keys() {
                let orig = key_name(k);
                let mut final_name = orig.clone();
                if instance_scoped {
                    final_name = unique_name(&format!("{}-{}", orig, label), &reserved);
                    reserved.insert(final_name.clone());
                } else if let Some((existing, owner)) =
                    taken_resources.get(&(kind.into(), orig.clone()))
                {
                    let incoming = entries.get(k).cloned().unwrap_or(Value::Null);
                    if *existing == incoming {
                        // Identical shared resource: keep the name, no rename.
                        reserved.insert(final_name.clone());
                        continue;
                    }
                    // Same name, different definition: a real conflict.
                    conflicts.push(MergeConflict {
                        kind: kind.to_string(),
                        name: orig.clone(),
                        kept_from: owner.clone(),
                        conflict_from: source.id.clone(),
                    });
                    if on_conflict == OnConflict::Error {
                        continue;
                    }
                    final_name = unique_name(&format!("{}-{}", label, orig), &reserved);
                    reserved.insert(final_name.clone());
                } else {
                    reserved.insert(final_name.clone());
                }
                if final_name != orig {
                    renamed_resources.insert(orig, final_name);
                }
            }
        }

        // ---- decide parameter renames for this slot ------------------------
        let template_params = scan_params(&source.raw);
        let mut renamed_params: BTreeMap<String, String> = BTreeMap::new();
        let mut param_name_set: HashSet<String> = taken_params.keys().cloned().collect();
        for p in template_params {
            if is_auto_var(&p) {
                continue;
            }
            let mut final_name = p.clone();
            if instance_scoped {
                final_name = unique_name(&format!("{}_{}", p, label), &param_name_set);
            } else if param_name_set.contains(&p) {
                let owner = taken_params.get(&p).cloned().unwrap_or_default();
                if owner != source.id {
                    conflicts.push(MergeConflict {
                        kind: "parameter".into(),
                        name: p.clone(),
                        kept_from: owner,
                        conflict_from: source.id.clone(),
                    });
                    if on_conflict == OnConflict::Error {
                        continue;
                    }
                }
                final_name = unique_name(&format!("{}_{}", p, label), &param_name_set);
            }
            param_name_set.insert(final_name.clone());
            taken_params.insert(final_name.clone(), source.id.clone());
            if final_name != p {
                renamed_params.insert(p, final_name);
            }
        }

        // Bail once, reporting every clash at the user picked "error".
        if on_conflict == OnConflict::Error && !conflicts.is_empty() {
            let mut msg = String::from(
                "Name conflicts between templates. Give each instance a unique name, or allow auto-renaming:\n",
            );
            for c in &conflicts {
                msg.push_str(&format!(
                    "  - {} '{}' from '{}' clashes with '{}'\n",
                    c.kind, c.name, c.conflict_from, c.kept_from
                ));
            }
            bail!(msg.trim_end().to_string());
        }

        // ---- emit this slot's services -------------------------------------
        let mut slot_services: Vec<String> = Vec::new();
        for k in raw_services.keys() {
            let orig = key_name(k);
            let final_name = renamed_services
                .get(&orig)
                .cloned()
                .unwrap_or_else(|| orig.clone());
            let mut body = raw_services.get(k).cloned().unwrap_or(Value::Null);

            rewrite_service_refs(&mut body, &renamed_services, &renamed_resources);
            rewrite_params_in_value(&mut body, &renamed_params);

            out_services.insert(Value::String(final_name.clone()), body);
            taken_services.insert(final_name.clone(), source.id.clone());
            slot_services.push(final_name);
        }

        // ---- emit this slot's resources ------------------------------------
        for kind in RESOURCE_KINDS {
            let Some(Value::Mapping(entries)) = doc.get(Value::String(kind.into())) else {
                continue;
            };
            let sink = out_resources.entry(kind).or_default();
            for k in entries.keys() {
                let orig = key_name(k);
                let final_name = renamed_resources
                    .get(&orig)
                    .cloned()
                    .unwrap_or_else(|| orig.clone());
                sink.insert(
                    Value::String(final_name.clone()),
                    entries.get(k).cloned().unwrap_or(Value::Null),
                );
                taken_resources.insert(
                    (kind.into(), final_name.clone()),
                    (
                        entries.get(k).cloned().unwrap_or(Value::Null),
                        source.id.clone(),
                    ),
                );
            }
        }

        // ---- non-service, non-resource top-level keys ----------------------
        for (k, v) in doc.iter() {
            let key = key_name(k);
            if key == "services" || RESOURCE_KINDS.contains(&key.as_str()) {
                continue;
            }
            match out_extras.get(Value::String(key.clone())) {
                Some(existing) if existing != v => {
                    let msg = format!(
                        "Top-level '{}' differs between templates; kept the first definition.",
                        key
                    );
                    if !warnings.contains(&msg) {
                        warnings.push(msg);
                    }
                }
                Some(_) => {}
                None => {
                    out_extras.insert(Value::String(key.clone()), v.clone());
                }
            }
        }

        if instance_scoped {
            warnings.push(format!(
                "Template '{}' instance '{}' was namespaced to stay independent.",
                source.id, label
            ));
        }

        plans.push(SlotPlan {
            template_id: source.id.clone(),
            instance: slot.instance.clone(),
            label,
            instance_scoped,
            services: slot_services,
            renamed_services,
            renamed_resources,
            renamed_params,
            params: Vec::new(),
        });
        slot_raws.push(source.raw.clone());
    }

    // ---- assemble the final document -------------------------------------
    let mut merged = Mapping::new();
    let merged_services = out_services.clone();
    merged.insert(
        Value::String("services".into()),
        Value::Mapping(out_services),
    );
    for kind in RESOURCE_KINDS {
        if let Some(m) = out_resources.get(kind) {
            if !m.is_empty() {
                merged.insert(Value::String(kind.into()), Value::Mapping(m.clone()));
            }
        }
    }
    for (k, v) in out_extras.iter() {
        merged.insert(k.clone(), v.clone());
    }

    // ---- cross-slot reference fixup ---------------------------------------
    // A template may reference a service owned by another slot (`webapp`
    // depends_on `redis`). If that name was renamed away, the reference would
    // dangle and compose would reject the whole file. Point it at the name
    // that actually exists -- unless the original name still exists, in which
    // case the reference already resolves as written.
    {
        let final_services: HashSet<String> = merged_services.keys().map(key_name).collect();
        let final_resources: HashSet<String> = out_resources
            .values()
            .flat_map(|m| m.keys().map(key_name))
            .collect();
        let final_params: HashSet<String> = taken_params.keys().cloned().collect();

        let mut svc_alias: BTreeMap<String, String> = BTreeMap::new();
        let mut res_alias: BTreeMap<String, String> = BTreeMap::new();
        let mut par_alias: BTreeMap<String, String> = BTreeMap::new();
        let mut owner: HashMap<String, usize> = HashMap::new();
        for (idx, plan) in plans.iter().enumerate() {
            for svc in &plan.services {
                owner.insert(svc.clone(), idx);
            }
            for (orig, final_name) in &plan.renamed_services {
                if !final_services.contains(orig) && !svc_alias.contains_key(orig) {
                    svc_alias.insert(orig.clone(), final_name.clone());
                }
            }
            for (orig, final_name) in &plan.renamed_resources {
                if !final_resources.contains(orig) && !res_alias.contains_key(orig) {
                    res_alias.insert(orig.clone(), final_name.clone());
                }
            }
            for (orig, final_name) in &plan.renamed_params {
                if !final_params.contains(orig) && !par_alias.contains_key(orig) {
                    par_alias.insert(orig.clone(), final_name.clone());
                }
            }
        }

        // Repeated instances of one template rename the same service name more
        // than once (redis -> redis-cache_a, redis-cache_b). That is expected
        // and must not warn -- each slot rewrites its own references. It only
        // becomes ambiguous when some *other* slot references the bare name, so
        // record the contested names and warn lazily, if actually used.
        let mut contested: HashSet<String> = HashSet::new();
        for plan in &plans {
            for (orig, final_name) in &plan.renamed_services {
                if let Some(existing) = svc_alias.get(orig) {
                    if existing != final_name {
                        contested.insert(orig.clone());
                    }
                }
            }
        }

        // Final `.env` keys per slot, after cross-slot alias rewriting.
        for (idx, plan) in plans.iter_mut().enumerate() {
            let mut par_map = par_alias.clone();
            par_map.extend(plan.renamed_params.clone());
            plan.params = scan_params(&slot_raws[idx])
                .iter()
                .map(|p| par_map.get(p).cloned().unwrap_or_else(|| p.clone()))
                .collect();
        }

        if let Some(Value::Mapping(services)) = merged.get_mut(Value::String("services".into())) {
            let keys: Vec<Value> = services.keys().cloned().collect();
            for k in keys {
                let idx = owner.get(&key_name(&k)).copied();
                // Slot-local renames win over global aliases.
                let mut svc_map = svc_alias.clone();
                let mut res_map = res_alias.clone();
                let mut par_map = par_alias.clone();
                if let Some(p) = idx.and_then(|i| plans.get(i)) {
                    svc_map.extend(p.renamed_services.clone());
                    res_map.extend(p.renamed_resources.clone());
                    par_map.extend(p.renamed_params.clone());
                }
                if let Some(body) = services.get_mut(&k) {
                    let before = serde_yaml::to_string(&*body).unwrap_or_default();
                    rewrite_service_refs(body, &svc_map, &res_map);
                    rewrite_params_in_value(body, &par_map);
                    let after = serde_yaml::to_string(&*body).unwrap_or_default();
                    if before != after {
                        for name in &contested {
                            // Skip names this slot renamed itself: its own
                            // references were already resolved unambiguously.
                            let own = idx
                                .and_then(|i| plans.get(i))
                                .map(|p| p.renamed_services.contains_key(name))
                                .unwrap_or(false);
                            if own {
                                continue;
                            }
                            if before.contains(name.as_str()) {
                                let chosen = svc_alias.get(name).cloned().unwrap_or_default();
                                let msg = format!(
                                    "Another template references service '{}', which was renamed; it now points at '{}'.",
                                    name, chosen
                                );
                                if !warnings.contains(&msg) {
                                    warnings.push(msg);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let compose = serde_yaml::to_string(&Value::Mapping(merged))
        .map_err(|e| anyhow!("Failed to serialise merged compose file: {}", e))?;

    Ok(Composition {
        compose,
        slots: plans,
        warnings,
        conflicts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(id: &str, raw: &str) -> TemplateSource {
        TemplateSource {
            id: id.into(),
            raw: raw.into(),
        }
    }

    fn slot(id: &str, instance: Option<&str>) -> Slot {
        Slot {
            template_id: id.into(),
            instance: instance.map(String::from),
        }
    }

    fn sources(v: Vec<TemplateSource>) -> HashMap<String, TemplateSource> {
        v.into_iter().map(|s| (s.id.clone(), s)).collect()
    }

    #[test]
    fn merges_two_distinct_templates() {
        let s = sources(vec![
            src("nginx", "services:\n  web:\n    image: nginx\n"),
            src("redis", "services:\n  cache:\n    image: redis\n"),
        ]);
        let out = compose(
            &s,
            &[slot("nginx", None), slot("redis", None)],
            OnConflict::Rename,
        )
        .unwrap();
        assert!(out.compose.contains("web:"));
        assert!(out.compose.contains("cache:"));
        assert_eq!(out.slots.len(), 2);
    }

    #[test]
    fn repeated_template_namespaces_services_and_params() {
        let raw = "services:\n  redis:\n    image: redis\n    environment:\n      PROJECT: ${COMPOSE_PROJECT_NAME}\nvolumes:\n  data: {}\n";
        let s = sources(vec![src("redis", raw)]);
        let out = compose(
            &s,
            &[
                slot("redis", Some("cache_a")),
                slot("redis", Some("cache_b")),
            ],
            OnConflict::Rename,
        )
        .unwrap();

        assert!(out.compose.contains("redis-cache_a:"));
        assert!(out.compose.contains("redis-cache_b:"));
        assert!(out.compose.contains("data-cache_a:"));
        assert!(out.compose.contains("data-cache_b:"));
        // Runtime vars keep their names: renaming them would break compose.
        assert!(out.compose.contains("PROJECT: ${COMPOSE_PROJECT_NAME}"));
        // Compose derives container names itself; we never pin one.
        assert!(!out.compose.contains("container_name"));
    }

    #[test]
    fn repeated_template_namespaces_params() {
        let raw =
            "services:\n  cache:\n    image: redis\n    ports:\n      - \"${REDIS_PORT}:6379\"\n";
        let s = sources(vec![src("redis", raw)]);
        let out = compose(
            &s,
            &[slot("redis", Some("a")), slot("redis", Some("b"))],
            OnConflict::Rename,
        )
        .unwrap();
        assert!(out.compose.contains("${REDIS_PORT_a}"));
        assert!(out.compose.contains("${REDIS_PORT_b}"));
        let plans = &out.slots;
        assert_eq!(
            plans[0]
                .renamed_params
                .get("REDIS_PORT")
                .map(String::as_str),
            Some("REDIS_PORT_a")
        );
        assert_eq!(
            plans[1]
                .renamed_params
                .get("REDIS_PORT")
                .map(String::as_str),
            Some("REDIS_PORT_b")
        );
    }

    #[test]
    fn single_use_template_keeps_original_names() {
        let raw = "services:\n  web:\n    image: nginx\n    ports:\n      - \"${HTTP_PORT}:80\"\n";
        let s = sources(vec![src("web", raw)]);
        let out = compose(&s, &[slot("web", None)], OnConflict::Rename).unwrap();
        assert!(out.compose.contains("web:"));
        assert!(out.compose.contains("${HTTP_PORT}"));
        assert!(out.slots[0].renamed_params.is_empty());
    }

    #[test]
    fn same_service_in_two_templates_errors_by_default() {
        let s = sources(vec![
            src("a", "services:\n  app:\n    image: a\n"),
            src("b", "services:\n  app:\n    image: b\n"),
        ]);
        let err = compose(&s, &[slot("a", None), slot("b", None)], OnConflict::Error).unwrap_err();
        assert!(err.to_string().contains("app"));

        let renamed = compose(&s, &[slot("a", None), slot("b", None)], OnConflict::Rename).unwrap();
        assert!(renamed.compose.contains("app:"));
        assert!(renamed.compose.contains("b-app:"));
    }

    #[test]
    fn rewrites_intra_template_references() {
        let raw = concat!(
            "services:\n",
            "  app:\n",
            "    image: a\n",
            "    depends_on: [db]\n",
            "    links: [\"db:database\"]\n",
            "    volumes_from: [\"container:db\"]\n",
            "    network_mode: \"service:db\"\n",
            "    extends:\n",
            "      service: db\n",
            "    networks: [backend]\n",
            "    volumes: [\"data:/var/lib\"]\n",
            "  db:\n",
            "    image: b\n",
            "volumes:\n",
            "  data: {}\n",
            "networks:\n",
            "  backend: {}\n",
        );
        let s = sources(vec![src("app", raw)]);
        let out = compose(
            &s,
            &[slot("app", Some("one")), slot("app", Some("two"))],
            OnConflict::Rename,
        )
        .unwrap();

        // Assert structurally: parse the merged file and inspect the first slot's
        // service, rather than matching serializer indentation.
        let doc: Value = serde_yaml::from_str(&out.compose).unwrap();
        let services = doc.get("services").unwrap().as_mapping().unwrap();
        let app = services.get(Value::String("app-one".into())).unwrap();

        let dep = app.get("depends_on").unwrap().as_sequence().unwrap();
        assert_eq!(dep[0].as_str(), Some("db-one"));

        let link = app.get("links").unwrap().as_sequence().unwrap();
        assert_eq!(link[0].as_str(), Some("db-one:database"));

        let vf = app.get("volumes_from").unwrap().as_sequence().unwrap();
        assert_eq!(vf[0].as_str(), Some("container:db-one"));

        assert_eq!(
            app.get("network_mode").unwrap().as_str(),
            Some("service:db-one")
        );

        let ext = app.get("extends").unwrap().as_mapping().unwrap();
        assert_eq!(ext.get("service").unwrap().as_str(), Some("db-one"));

        let nets = app.get("networks").unwrap().as_sequence().unwrap();
        assert_eq!(nets[0].as_str(), Some("backend-one"));

        let vols = app.get("volumes").unwrap().as_sequence().unwrap();
        assert_eq!(vols[0].as_str(), Some("data-one:/var/lib"));

        // Top-level resources were renamed in lockstep.
        let top_vols = doc.get("volumes").unwrap().as_mapping().unwrap();
        assert!(top_vols.contains_key(Value::String("data-one".into())));
        let top_nets = doc.get("networks").unwrap().as_mapping().unwrap();
        assert!(top_nets.contains_key(Value::String("backend-one".into())));
    }

    #[test]
    fn conflicting_network_definitions_are_reported() {
        let s = sources(vec![
            src(
                "a",
                "services:\n  a: {image: a}\nnetworks:\n  net:\n    driver: bridge\n",
            ),
            src(
                "b",
                "services:\n  b: {image: b}\nnetworks:\n  net:\n    driver: overlay\n",
            ),
        ]);
        let err = compose(&s, &[slot("a", None), slot("b", None)], OnConflict::Error).unwrap_err();
        assert!(err.to_string().contains("net"));
    }

    #[test]
    fn identical_network_definitions_merge_cleanly() {
        let s = sources(vec![
            src(
                "a",
                "services:\n  a: {image: a}\nnetworks:\n  net:\n    driver: bridge\n",
            ),
            src(
                "b",
                "services:\n  b: {image: b}\nnetworks:\n  net:\n    driver: bridge\n",
            ),
        ]);
        let out = compose(&s, &[slot("a", None), slot("b", None)], OnConflict::Rename).unwrap();
        assert_eq!(out.compose.matches("net:").count(), 1);
    }

    #[test]
    fn duplicate_slot_selection_is_rejected() {
        let s = sources(vec![src("r", "services:\n  r: {image: r}\n")]);
        let err = compose(
            &s,
            &[slot("r", Some("x")), slot("r", Some("x"))],
            OnConflict::Rename,
        )
        .unwrap_err();
        assert!(err.to_string().contains("more than once"));
    }

    #[test]
    fn top_level_version_keeps_first_and_warns() {
        let s = sources(vec![
            src("a", "version: \"3.8\"\nservices:\n  a: {image: a}\n"),
            src("b", "version: \"3.9\"\nservices:\n  b: {image: b}\n"),
        ]);
        let out = compose(&s, &[slot("a", None), slot("b", None)], OnConflict::Rename).unwrap();
        assert!(out.compose.contains("3.8"));
        assert!(!out.compose.contains("3.9"));
        assert!(out.warnings.iter().any(|w| w.contains("version")));
    }

    #[test]
    fn fixes_cross_template_reference_to_a_renamed_service() {
        let s = sources(vec![
            src("redis", "services:\n  redis:\n    image: redis\n"),
            src(
                "webapp",
                "services:\n  web:\n    image: nginx\n    depends_on: [redis]\n    links: [\"redis:cache\"]\n",
            ),
        ]);
        // redis is instance-named, so its service becomes `redis-main`; webapp's
        // reference would otherwise dangle and compose would reject the file.
        let out = compose(
            &s,
            &[slot("redis", Some("main")), slot("webapp", None)],
            OnConflict::Rename,
        )
        .unwrap();

        let doc: Value = serde_yaml::from_str(&out.compose).unwrap();
        let services = doc.get("services").unwrap().as_mapping().unwrap();
        let web = services.get(Value::String("web".into())).unwrap();

        let dep = web.get("depends_on").unwrap().as_sequence().unwrap();
        assert_eq!(dep[0].as_str(), Some("redis-main"));
        let link = web.get("links").unwrap().as_sequence().unwrap();
        assert_eq!(link[0].as_str(), Some("redis-main:cache"));
    }

    #[test]
    fn leaves_reference_alone_when_original_name_survives() {
        // `redis` keeps its name here, so a reference to `redis` must not move.
        let s = sources(vec![
            src("redis", "services:\n  redis:\n    image: redis\n"),
            src(
                "webapp",
                "services:\n  web:\n    image: nginx\n    depends_on: [redis]\n",
            ),
            src("redis2", "services:\n  redis:\n    image: redis:7\n"),
        ]);
        let out = compose(
            &s,
            &[
                slot("redis", None),
                slot("webapp", None),
                slot("redis2", Some("second")),
            ],
            OnConflict::Rename,
        )
        .unwrap();

        let doc: Value = serde_yaml::from_str(&out.compose).unwrap();
        let services = doc.get("services").unwrap().as_mapping().unwrap();
        let web = services.get(Value::String("web".into())).unwrap();
        let dep = web.get("depends_on").unwrap().as_sequence().unwrap();
        assert_eq!(dep[0].as_str(), Some("redis"));
    }

    #[test]
    fn scans_params_without_touching_escapes() {
        assert_eq!(
            scan_params("a: ${A}\nb: $B\nc: $$X\nd: ${C:-d}\ne: $E_suffix"),
            vec!["A", "B", "C", "E_suffix"]
        );
    }
}
