# Unified workspace proposal

Status: superseded by the implemented [Unified workspace foundation](workspace-foundation.md).

The preliminary design extracted shared presentation and resource placement. The foundation now also owns real tab containers, scoped groups, selection, lifecycle and versioned persistence across terminal, code, AI and common workspaces. The projection-only model and duplicate terminal group mutation APIs have been removed.

Resource content remains domain-owned: moving a pane does not recreate its process, document buffer, conversation stream or approval state. The older terminal history payload is a validated wire adapter of the shared generic tree. Existing close guards, file access and explicit execution targets remain in force.

The foundation document records the ownership map, migration, deletion/archive semantics, refactoring findings and 100% coverage gate. It is the current implementation and verification reference.
