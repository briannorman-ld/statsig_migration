> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Member role concepts

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic is an overview of concepts that are important to creating roles for members and teams.

A role is a description of access that a team or member has within LaunchDarkly. Each member must have at least one role assigned to them, either directly or through a team. This is true even if the role explicitly prohibits the member from accessing any information within LaunchDarkly.

To work with roles, you'll need to understand the following key concepts:

* [Base roles](#base-roles)
* [Preset roles](#preset-roles)
* [Resources](#resources)
* [Actions](#actions)
* [Policies](#policies)
* [Property-based selectors](#property-based-selectors)

## Base roles

Every LaunchDarkly account comes with several built-in [base roles](/docs/home/getting-started/vocabulary#base-role), each of which is a set of permissions that describes the access a member has. LaunchDarkly provides Reader, Writer, Admin, and Owner base roles. Some customers also have a restricted No access role.

When you invite a new member to your LaunchDarkly account, you must assign them a role as part of creating the invitation. To learn how, read [Add members to LaunchDarkly](/docs/home/account/members#add-members-to-launchdarkly).

## Preset roles

In addition to base roles, customers on select plans have access to several [organization roles](/docs/home/getting-started/vocabulary#organization-role) and [project roles](/docs/home/getting-started/vocabulary#project-role) provided by LaunchDarkly. These provide different sets of permissions that are commonly grouped together, designed around typical personas. For example, LaunchDarkly provides a Developer project role that can perform all flag actions within projects it is assigned to, and a Contributor project role that can make changes to flag status but cannot perform destructive actions on it.

If you are looking for example roles or policies, we recommend that you start by examining the preset organization and project roles provided by LaunchDarkly. You can also add policy statements to these roles, if the permissions they provide are not quite what works best for your organization. We also provide a few [example roles and policies](/docs/home/account/roles/example-roles) in our documentation.

Customers on select plans also have the ability to create their own roles, sometimes called custom roles. When you create your own role, you define the access using a set of statements. Each statement comprises [resources](#resources) and [actions](#actions), and together the set of statements is called a [policy](#policies). You can read more about these concepts in the sections below.

## Resources

Each role specifies **resources** that the role can or cannot access, as part of the scope for each policy statement.

LaunchDarkly has many kinds of resources, such as:

* Projects
* Environments
* Feature flags
* AgentControl configs
* Metrics
* Experiments
* Context kinds
* Segments

For a full list of LaunchDarkly resources, read [Using resources](/docs/home/account/roles/role-resources).

To learn how to set the role scope, including your options for how to specify the **resources**, read [Using role scope](/docs/home/account/roles/role-scope).

## Actions

Each resource has a set of actions associated with it. By granting a role resource-specific actions, you allow or forbid members with that role to do things to that resource. For example, you can grant a role the ability to delete a project.

To learn more about specific actions, read [Using actions](/docs/home/account/roles/role-actions).

## Policies

Policies combine resources and actions into a set of statements that define what members can or cannot do in LaunchDarkly.

You use LaunchDarkly's **Policy builder** to build roles by selecting combinations of resources and actions the role is allowed to or forbidden from taking on them.

<Note>
  **Permissions are cumulative**

  If an [account member has one or more roles](/docs/home/account/roles/manage-role-assignments), then the account member's access is defined by those roles. If the roles have conflicting permissions levels, the more permissive level of access is applied. For example, if a member has one role that allows access to a resource, and another role that restricts access to a resource, the member is allowed access.

  If a [team has one or more roles](/docs/home/account/roles/manage-role-team#how-team-roles-interact-with-individual-member-roles), then for each account member on the team, the account member's access is defined by both the member's role and the roles assigned to the team.

  For example, if a member has a Reader base role and is assigned another role through their team, then the member will continue to have read access to all resources through the Reader role, in addition to the access granted through their team. As another example, if a member is assigned the LaunchDarkly Member role directly, and is assigned the LaunchDarkly Developer role through their team, the Developer access is used in addition to Member access.
</Note>

You can create most roles using the graphical **Policy builder**. If needed, you can also define a role directly in JSON, using the advanced editor.

<Note>
  **The advanced editor is powerful**

  The advanced editor can cause large permissions changes to sensitive or confidential resources. If you use the advanced editor incorrectly, it is possible to create a role that disables your LaunchDarkly project, locks yourself out of your account, or causes other irrevocable changes.

  It is critically important that you read all the documentation in the [Member role concepts](/docs/home/account/roles/role-concepts) section thoroughly before you use the advanced editor to create or modify any roles.

  To learn more, read [Using the advanced editor](/docs/home/account/roles/advanced-editor).
</Note>

Policies are represented as JSON arrays. They require you to use [project](/docs/home/account/project#project-keys) and [environment keys](/docs/home/account/environment#environment-and-sdk-credentials), not names.

Each element in the array is a statement represented as a JSON object with three attributes:

* `effect`
* `actions` / `notActions`
* `resources` / `notResources`

The example below shows a policy that allows the role recipient to perform all actions on a flag called `exampleFlag`:

<CodeGroup>
  ```json title="Policy" lines wrap theme={null}
  [
    {
      "effect": "allow",
      "actions": ["*"],
      "resources": ["proj/*:env/*:flag/exampleFlag"]
    }
  ]
  ```
</CodeGroup>

To learn more about specific policies, read [Using policies](/docs/home/account/roles/role-policies).

### Creating or updating policies

When you create or update a role, you specify the role policy using the **Policy builder**.

There are a few ways to approach updating role policies:

* Allow no access by default, then strategically allow actions as needed. This method is the most secure. This method works well if you use LaunchDarkly preset roles, because these roles are regularly updated when LaunchDarkly releases new features. However, if you create your own roles, this method can create additional work for your administrators because they must explicitly add permissions to roles each time LaunchDarkly releases a new feature.
* Allow all actions by default, then strategically deny actions as needed. We do not consider this a best security practice, because it means that all members, regardless of role, are automatically granted access to new features. Administrators will need to explicitly deny access to new features in role policies as needed.

<Note>
  **Read access is project-scoped**

  Denying edit actions on an environment or its child resources restricts what members can modify. However, it does not prevent them from viewing resources in that environment. Instead, view access is controlled by the `viewProject` action on the `proj/*` resource. This action applies to all resources in all of the project's environments, including flags, configs, segments, and other resources.
</Note>

For additional discussion on how to decide between these approaches, read the [Creating roles](/docs/guides/teams-roles/custom-roles) guide.

### Minimum required actions

As a default state, a blank role denies access to all resources. You must explicitly grant access to a resource for a member to view or edit it.

## Property-based selectors

All resources, such as projects, environments, and flags, have various properties. Some resource properties are available to use in a resource specifier. You can select for resources whose properties match a particular value.

You append a selector to the resource it applies to, after a semicolon (`;`), using the syntax `{selector:value}`. To learn more about where selectors fit within a resource specifier, read [Using resources](/docs/home/account/roles/role-resources#specifying-resources-in-the-advanced-editor).

This table describes the available property-based selectors:

<table>
  <thead>
    <tr>
      <th>Selector</th>
      <th>Resource type</th>
      <th>Values</th>
      <th>Description</th>
      <th>Example</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        <code>critical</code>
      </td>

      <td>
        <code>env</code>
      </td>

      <td>
        <code>true</code>, <code>false</code>
      </td>

      <td>
        Selects environments based on whether they are marked as critical. To learn more, read [Critical environments](/docs/home/account/environment#critical-environments).
      </td>

      <td>
        <code>
          {'proj/*:env/*;{critical:true}'}
        </code>
      </td>
    </tr>

    <tr>
      <td>
        <code>affectsSdkPayload</code>
      </td>

      <td>
        <code>view</code>
      </td>

      <td>
        <code>true</code>, <code>false</code>
      </td>

      <td>
        Selects views based on whether they are used to filter SDK payloads. To learn more, read [Filtered SDK payloads](/docs/sdk/concepts/payload-filtering).
      </td>

      <td>
        <code>
          {'proj/*:view/*;{affectsSdkPayload:true}'}
        </code>
      </td>
    </tr>
  </tbody>
</table>

To view example custom roles that use property-based selectors, read [Example roles and policies](/docs/home/account/roles/example-roles).
