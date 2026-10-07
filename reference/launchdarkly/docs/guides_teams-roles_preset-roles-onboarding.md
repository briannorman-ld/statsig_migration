> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Onboarding to preset roles

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

<Note>
  **Preset roles are available to customers on select plans**

  Preset roles are only available to customers on select plans. To learn more, [read about our pricing](https://launchdarkly.com/pricing/). To upgrade your plan, [contact Sales](https://launchdarkly.com/contact-sales/).
</Note>

<Note>
  **Project roles provided by LaunchDarkly are available for early access**

  Project roles provided by LaunchDarkly may be available in your account as part of our Early Access Program (EAP). If these roles are available, a banner appears on the **Roles** page prompting you to add the roles to your account. After you add these roles, you can assign them to any member. These roles all have names that start with "LaunchDarkly."

  To request access these provided roles, [request to join the EAP](mailto:product@launchdarkly.com).
</Note>

This topic explains how to start using preset roles. Preset roles let you onboard new members quickly without having to build custom roles from scratch. These roles streamline permission management by grouping common sets of permissions applicable to different team members.

Preset roles facilitate the efficient onboarding of new team members by letting you quickly assign standardized permissions. They reduce complexity by letting you avoid manually creating complex permission sets. They also provide consistency and security by applying standardized permissions across projects and your entire account.

Preset roles use role attributes, which are parameters for the role's scope. Members with appropriate permissions can expand permissions to these pre-built roles to meet specific organizational requirements. To learn more, read [Using role scope](/docs/home/account/roles/role-scope).

LaunchDarkly's base roles (Reader, Writer, Admin, Owner, No access) still exist. Customers with access to preset roles may continue to use base roles when assigning permissions to any member. To learn more, read [Roles](/docs/home/account/roles).

## Preset role categories

There are different types of preset roles: project roles and organization roles. Project roles are scoped to individual projects, while organization roles apply across your entire account.

### Project roles

* **LaunchDarkly Contributor**: Can update flag statuses and perform releases. Cannot create or delete flags.
* **LaunchDarkly Developer**: Can take any actions on flags that are within projects or [views](/docs/home/account/views) assigned to that team member.
* **LaunchDarkly Maintainer**: Can manage resources grouping flags, such as projects and views.
* **LaunchDarkly Project Admin**: Can perform all project-level actions.
* **LaunchDarkly Viewer**: Can only read project data. Cannot take any actions.

To learn more, read [Project roles](/docs/home/account/roles/project-roles).

### Organization roles

* **LaunchDarkly Billing Admin**: Can manage billing and payment details
* **LaunchDarkly Admin**: Can control administrative settings and manage projects and team memberships. Cannot take actions on billing or payment details.
* **LaunchDarkly Architect**: Manages flags and top-level resources across all projects. Cannot take account-level actions.
* **LaunchDarkly Member**: Default role with no permissions, unless assigned additional project roles.

To learn more, read [Organization roles](/docs/home/account/roles/organization-roles).

## Prerequisites: Enable preset roles for your account

Before you can use preset roles, a member with an Admin or Owner base role must enable them.

Here's how:

1. Log in to LaunchDarkly as a member with an Admin or Owner base role.

2. Click on the **gear** icon. The Organization settings page appears.

3. Select **Roles** from the Access section.

4. Find the banner prompting you to add preset roles to your account:

   <Frame caption="The &#x22;Roles&#x22; page with a banner prompting you to review preset roles.">
     <img src="https://mintcdn.com/launchdarkly/7dOLLfhGme_BglBp/images/__LD_UI_no_test/preset-roles-initial-review.png?fit=max&auto=format&n=7dOLLfhGme_BglBp&q=85&s=469c39a3d22922ddcaf9d11c80ae2b05" alt="The &#x22;Roles&#x22; page with a banner prompting you to review preset roles." width="1538" height="528" data-path="images/__LD_UI_no_test/preset-roles-initial-review.png" />
   </Frame>

5. Click **Review**.

6. In the "Predefined roles" dialog, click **\<** and **>** to review the policies for each preset role. These roles all have names that start with "LaunchDarkly."

7. Click **Accept** to enable the new roles in your account.

After you add these roles, you can assign them to any member. Optionally, you can [update the preset project roles](/docs/home/account/roles/project-roles#update-project-roles) or [preset organization roles](/docs/home/account/roles/organization-roles#update-organization-roles) to them to customize them.

## Review preset roles

To access these roles:

1. Log in to LaunchDarkly.
2. Click on the **gear** icon. The Organization settings page appears.
3. Select **Roles** from the Access section.
4. Choose from the list of preset roles.
5. Click the role name to review the access it provides.

## Assign preset roles

To assign a role to an existing member:

1. Click the **gear** icon in the left sidebar to view Organization settings.
2. Click **Members**. The **Members** list appears.
3. Find the account member you wish to give a role.
4. Click that account member's name. The member's **Access** tab opens.
5. Click **Assign access**. The "Assign access" dialog appears.
6. Choose a preset role from the dropdown.
7. Click **Assign access**. You are returned to the **Access** tab.

## Next steps

* [Manage roles](/docs/home/account/roles/manage-roles)
* [Manage role assignments](/docs/home/account/roles/manage-role-assignments)
