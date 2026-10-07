> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Project roles

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

<Note>
  **Project roles are available to customers on select plans**

  Customers on select plans have access to project roles provided by LaunchDarkly, and can also create their own project roles. To learn more, [read about our pricing](https://launchdarkly.com/pricing/). To upgrade your plan, [contact Sales](https://launchdarkly.com/contact-sales/).
</Note>

<Note>
  **Project roles provided by LaunchDarkly are available for early access**

  Project roles provided by LaunchDarkly may be available in your account as part of our Early Access Program (EAP). If these roles are available, a banner appears on the **Roles** page prompting you to add the roles to your account. After you add these roles, you can assign them to any member. These roles all have names that start with "LaunchDarkly."

  To request access these provided roles, [request to join the EAP](mailto:product@launchdarkly.com).
</Note>

This topic explains the project roles that come with some LaunchDarkly accounts, and how they relate to each other.

## Project roles

LaunchDarkly provides the following [preset](/docs/home/getting-started/vocabulary#preset-roles) project roles: Project Admin, Maintainer, Developer, Contributor, Viewer.

You can modify these preset roles if needed. Specifically, you can add policy statements to these roles, and then update or remove the policy statements that you have added. You cannot update the policy statements that the preset roles include by default.

You can also create your own project roles. To learn how, read [Creating roles and policies](/docs/home/account/roles/role-create).

You can assign each member as many project roles as you like.

## Update project roles

You can update [preset](/docs/home/getting-started/vocabulary#preset-roles) project roles in the following ways:

* You can add new policy statements to them. To learn how, read [Editing roles](/docs/home/account/roles/role-edit). You can also remove policy statements that you have added to preset roles. However, you cannot change the policy statements that are included as part of the preset roles.

* You can review and accept updates to the preset roles that are provided by LaunchDarkly. LaunchDarkly periodically updates all preset organization and project roles. For example, when new [resources](/docs/home/account/roles/role-resources) become available, the preset Project Admin or Maintainer roles may be updated to include access to them.

When updates to the LaunchDarkly preset project roles are available, account members with an Admin role receive an update notification on the **Roles** page.

To review and accept updates to the preset project roles:

1. Click the **gear** icon in the left sidebar to view Organization settings.
2. Click **Roles**.
3. Click **View changes** from the "Updates to predefined roles" notification.
   * Only account members with a LaunchDarkly Admin role, an Admin base role, or an Owner base role receive this notification.
   * This notification only appears when new preset roles are available.
4. In the "Updated roles" dialog, review the changes to the preset roles.
5. Click **Apply all changes**.

After you apply the changes, all account members with preset roles now have updated permissions.

## Allow viewProject permission

All new roles start with no access. This means the roles cannot take any actions on any resources.

As a result, you must explicitly add the `viewProject` permission to any roles that you create.

Here's how:

<CodeGroup>
  ```json title="Policy statement to view projects" lines wrap theme={null}
  [
    {
      "effect": "allow",
      "actions": [
        "viewProject"
      ],
      "resources": ["proj/${roleAttribute/projectKey}"]
    }
  ]
  ```
</CodeGroup>

This example uses [role scope](/docs/home/account/roles/role-scope) to specify the projects. This means you can set the specific projects that are viewable when you assign this role to a member or team. You could also set the project in the policy itself using `"resources": ["proj/project-1"]`.

The preset project roles all include the `viewProject` permission.

<Note>
  **Read access is project-scoped**

  Denying edit actions on an environment or its child resources restricts what members can modify. However, it does not prevent them from viewing resources in that environment. Instead, view access is controlled by the `viewProject` action on the `proj/*` resource. This action applies to all resources in all of the project's environments, including flags, configs, segments, and other resources.
</Note>
