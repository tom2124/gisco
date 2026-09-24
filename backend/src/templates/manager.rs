use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::info;

use crate::compose::{extract_description, strip_description, valid_path_component, StacksManager};

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
        if !valid_path_component(id) {
            anyhow::bail!("Invalid template id '{}'", id);
        }
        let yml_path = self.template_dir.join(format!("{}.yml", id));
        let yaml_path = self.template_dir.join(format!("{}.yaml", id));

        let file_path = if yml_path.exists() {
            yml_path
        } else if yaml_path.exists() {
            yaml_path
        } else {
            anyhow::bail!("Template '{}' not found", id);
        };

        let filename = file_path.file_name().unwrap().to_string_lossy().to_string();
        let raw_content = fs::read_to_string(&file_path)?;

        Ok(TemplateDetails {
            id: id.to_string(),
            name: id.to_string(),
            filename,
            raw_content,
        })
    }

    pub fn save_template(&self, id: &str, content: &str, overwrite: bool) -> Result<()> {
        if !valid_path_component(id) {
            anyhow::bail!("Invalid template id '{}'", id);
        }
        let yml_path = self.template_dir.join(format!("{}.yml", id));
        let yaml_path = self.template_dir.join(format!("{}.yaml", id));
        // Preserve the extension of user-supplied templates so editing a
        // `.yaml` file does not leave both extensions behind.
        let file_path = if !yml_path.exists() && yaml_path.exists() {
            yaml_path
        } else {
            yml_path
        };
        if !overwrite && file_path.exists() {
            anyhow::bail!("Template '{}' already exists", id);
        }
        fs::write(&file_path, content)?;
        info!("Saved template '{}' at {:?}", id, file_path);
        Ok(())
    }

    pub fn delete_template(&self, id: &str) -> Result<()> {
        if !valid_path_component(id) {
            anyhow::bail!("Invalid template id '{}'", id);
        }
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
        if self.stacks_manager.stack_exists(stack_name)? {
            anyhow::bail!("Stack '{}' already exists", stack_name);
        }

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

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_dir(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gisco_{}_{}",
            prefix,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_template_summary_from_path() {
        let dir = unique_dir("tplsum");
        let path = dir.join("my-app.yml");
        fs::write(&path, "# desc: Demo app\nservices: {}\n").unwrap();

        let summary = template_summary_from_path(&path).unwrap();
        assert_eq!(summary.id, "my-app");
        assert_eq!(summary.name, "my-app");
        assert_eq!(summary.filename, "my-app.yml");
        assert_eq!(summary.description.as_deref(), Some("Demo app"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_save_preserves_yaml_extension() {
        let dir = unique_dir("tpl_ext");
        let yaml_path = dir.join("existing.yaml");
        fs::write(&yaml_path, "services: {}\n").unwrap();

        let manager = TemplatesManager::new(
            dir.clone(),
            StacksManager::new(dir.join("stacks"), 1000, 1000),
        );
        manager
            .save_template("existing", "services:\n  app: {}\n", true)
            .unwrap();

        assert!(yaml_path.exists());
        assert!(!dir.join("existing.yml").exists());
        assert!(manager
            .save_template("existing", "services: {}\n", false)
            .unwrap_err()
            .to_string()
            .contains("already exists"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_instantiate_strips_desc_and_writes_env() {
        let template_dir = unique_dir("tplinst");
        let stack_dir = unique_dir("tplstacks");
        fs::write(
            template_dir.join("demo.yml"),
            "# desc: Reusable demo\nservices:\n  app:\n    image: alpine\n",
        )
        .unwrap();

        let stacks = StacksManager::new(stack_dir.clone(), 1000, 1000);
        let manager = TemplatesManager::new(template_dir.clone(), stacks);
        manager
            .instantiate_template("demo", "demo-1", Some("PORT=9090"), None, None)
            .unwrap();

        let compose = fs::read_to_string(stack_dir.join("demo-1").join("compose.yml")).unwrap();
        assert!(!compose.contains("# desc:"));
        assert!(compose.contains("image: alpine"));
        let env = fs::read_to_string(stack_dir.join("demo-1").join(".env")).unwrap();
        assert_eq!(env, "PORT=9090");

        let overwrite = manager
            .instantiate_template("demo", "demo-1", Some("PORT=9999"), None, None)
            .unwrap_err();
        assert!(overwrite.to_string().contains("already exists"));
        assert_eq!(
            fs::read_to_string(stack_dir.join("demo-1").join(".env")).unwrap(),
            "PORT=9090"
        );

        let _ = fs::remove_dir_all(template_dir);
        let _ = fs::remove_dir_all(stack_dir);
    }
}
