pub mod manager;
pub mod merge;

#[allow(unused_imports)]
pub use manager::{TemplateDetails, TemplateSummary, TemplatesManager};
#[allow(unused_imports)]
pub use merge::{Composition, MergeConflict, OnConflict, Slot, SlotPlan};
