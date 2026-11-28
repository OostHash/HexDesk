//! Platforms without a check yet: every start counts as the first. Linux
//! support is tracked in #19.

use std::io;

use super::ObjectNames;

pub(super) struct Instance;

pub(super) fn start(_names: &ObjectNames) -> io::Result<Option<Instance>> {
    Ok(Some(Instance))
}

impl Instance {
    pub(super) fn on_second_start<F>(&self, _on_start: F) -> io::Result<()>
    where
        F: Fn() + Send + 'static,
    {
        Ok(())
    }

    pub(super) fn release(&self) {}
}
