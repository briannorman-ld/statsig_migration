> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Approval request settings

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic explains how to customize the settings for your approval requests.

## Approval settings

You can customize how approval requests are managed and enforced by making changes in an environment's **Approval settings**.

For each environment, you can specify:

* whether approvals are required for changes to flags, AgentControl configs, experiments, or segments in the environment
* whether requestors can approve their own requests
* how many approvals are required before a requester can apply a change
* whether consensus is required, that is, whether the requester can apply changes if any reviewers have declined a request
  * Members can approve and apply requests when they have the `reviewApprovalRequest` and `applyApprovalRequest` actions for [flags and experiments](/docs/home/account/roles/role-actions#feature-flag-actions), [segments](/docs/home/account/roles/role-actions#segment-actions), or [AgentControl configs](/docs/home/account/roles/role-actions#agentcontrol-config-actions). To learn more, read [Roles](/docs/home/account/roles).
* Some flag changes, like turning targeting on or off or changing targeting rules, affect the flag only at the environment level. Other flag changes, like editing flag variations, affect the flag at the project level.
* Similarly, AgentControl config changes can affect one or more environments in a project.
* Segment changes affect only the environment in which the segment is defined.

If a change that affects an environment with approvals required is made, the change will trigger an approval request.

Enterprise customers can customize an environment's approval settings in the "Edit environment" panel for that environment. To learn more, read [Configuring approvals for an environment](/docs/home/releases/approval-config).

The following actions do not trigger an approval request:

* Changing a flag's name, maintainer, description, or tags
* Creating, archiving, or deleting a flag
* Changing an AgentControl config's name, maintainer, description, or tags
* Creating, archiving, or deleting an AgentControl config
* Creating or deleting an experiment
* Changing a segment's name, description, or tags
* Creating or deleting a segment

To prevent members from making these kinds of changes, you can configure and assign custom roles that deny these actions. To learn how, read [Roles](/docs/home/account/roles).
