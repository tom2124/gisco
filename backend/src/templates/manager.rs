use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::info;

use crate::compose::{extract_description, strip_description, StacksManager};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TemplateSummary {
    pub id: String,
    pub name: String,
    pub filename: String,
    /// From a top-level `# desc: ...` comment in the template, if any.
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TemplateDetails {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub raw_content: String,
}

#[derive(Clone)]
pub struct TemplatesManager {
    template_dir: PathBuf,
    stacks_manager: StacksManager,
}

impl TemplatesManager {
    pub fn new(template_dir: PathBuf, stacks_manager: StacksManager) -> Self {
        Self {
            template_dir,
            stacks_manager,
        }
    }

    pub fn list_templates(&self) -> Result<Vec<TemplateSummary>> {
        let mut list = Vec::new();

        if !self.template_dir.exists() {
            return Ok(list);
        }

        let entries = fs::read_dir(&self.template_dir).context("Reading template dir")?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if ext == "yml" || ext == "yaml" {
                        if let Some(summary) = template_summary_from_path(&path) {
                            list.push(summary);
                        }
                    }
                }
            }
        }

        list.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(list)
    }

    pub fn get_template(&self, id: &str) -> Result<TemplateDetails> {
        let yml_path = self.template_dir.join(format!("{}.yml", id));
        let yaml_path = self.template_dir.join(format!("{}.yaml", id));

        let file_path = if yml_path.exists() {
            yml_path
        } else if yaml_path.exists() {
            yaml_path
        } else {
            anyhow::bail!("Template '{}' not found", id);
        };

        let filename = file_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let raw_content = fs::read_to_string(&file_path)?;

        Ok(TemplateDetails {
            id: id.to_string(),
            name: id.to_string(),
            filename,
            raw_content,
        })
    }

    pub fn save_template(&self, id: &str, content: &str) -> Result<()> {
        let file_path = self.template_dir.join(format!("{}.yml", id));
        fs::write(&file_path, content)?;
        info!("Saved template '{}' at {:?}", id, file_path);
        Ok(())
    }

    pub fn delete_template(&self, id: &str) -> Result<()> {
        let yml_path = self.template_dir.join(format!("{}.yml", id));
        let yaml_path = self.template_dir.join(format!("{}.yaml", id));

        if yml_path.exists() {
            fs::remove_file(yml_path)?;
        } else if yaml_path.exists() {
            fs::remove_file(yaml_path)?;
        }
        Ok(())
    }

    /// Copy the template compose file into a new stack directory, writing the
    /// provided env_content as the stack's `.env` file.
    pub fn instantiate_template(
        &self,
        template_id: &str,
        stack_name: &str,
        env_content: Option<&str>,
        custom_uid: Option<u32>,
        custom_gid: Option<u32>,
    ) -> Result<()> {
        let template = self.get_template(template_id)?;

        self.stacks_manager.save_stack(
            stack_name,
            &strip_description(&template.raw_content),
            env_content,
            custom_uid,
            custom_gid,
        )?;

        info!(
            "Instantiated template '{}' into new stack '{}'",
            template_id, stack_name
        );
        Ok(())
    }
}

fn template_summary_from_path(path: &Path) -> Option<TemplateSummary> {
    let filename = path.file_name()?.to_string_lossy().to_string();
    let stem = path.file_stem()?.to_string_lossy().to_string();
    let description = fs::read_to_string(path)
        .ok()
        .and_then(|content| extract_description(&content));
    Some(TemplateSummary {
        id: stem.clone(),
        name: stem,
        filename,
        description,
    })
}
