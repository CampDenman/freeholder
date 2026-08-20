---
"freeholder": minor
---

Managed agents now actually run. A connection of kind `managed` has its tasks claimed and executed by the platform every minute: the model is shown the task (untrusted input fenced as quoted data) and the same tool surface an MCP client sees, reads run under the agent's own key, and every change goes through the approval gate — executed, proposed, or parked for the owner according to the autonomy ladder. Runs are bounded (24 turns, eight minutes), failures retry to the attempt ceiling and then park as needs-attention, the kill switch stops claiming, and finishing a run no longer overwrites a task the gate parked for approval.
