pub mod manager;
pub mod runner;

#[allow(unused_imports)]
pub use manager::{
    description, extract_description, strip_description, valid_path_component, valid_stack_name,
    StackDetails, StackStatus, StackSummary, StacksManager, DESC_KEY,
};
pub use runner::{project_action_allowed, ComposeRunner};
