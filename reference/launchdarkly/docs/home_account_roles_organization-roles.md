> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Organization roles

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic explains the organization roles that come with every LaunchDarkly account, and how they relate to each other.

## Organization roles

Every LaunchDarkly account comes with several built-in organization roles, which are also called base roles: Reader, Writer, Admin, and Owner.

Customers on select plans also have:

* access to a No access base role.
* access to several additional organization roles provided by LaunchDarkly, also called [preset roles](/docs/home/getting-started/vocabulary#preset-roles). These provide different sets of permissions that are commonly grouped together, designed around typical personas.

<Note>
  **Additional organization roles provided by LaunchDarkly are available for early access**

  Additional organization roles provided by LaunchDarkly may be available in your account as part of our Early Access Program (EAP). If these roles are available, a banner appears on the **Roles** page prompting you to add the roles to your account. After you add these roles, you can assign them to any member. These roles all have names that start with "LaunchDarkly."

  To request access these provided roles, [request to join the EAP](mailto:product@launchdarkly.com).
</Note>

The account member who created your LaunchDarkly account is granted the Owner base role automatically, because those permissions are required to configure your account and to add more account members. Only one account member can have the Owner role at a time. You can change which member has the Owner role after there is more than one account member in your LaunchDarkly account. To learn more, read [Changing account owners](/docs/home/account/roles/owners).

<Tip>
  **The No access and Member roles give your organization the most control**

  We recommend giving all new members the Member role or No access base role to start, if these roles are included in your plan. These roles provide no access: the member cannot read or interact with anything in your LaunchDarkly account until they are also assigned another role with additional access, such as a [project role](/docs/home/account/roles/project-roles). The Member role and the No access base role are identical.

  Some customers, especially those in highly regulated industries, do not want members to have view access to everything in their LaunchDarkly account when they first join. The Member and No access roles can help your organization manage access to resources within LaunchDarkly and enforce security best practices, such as the [principle of least privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege).
</Tip>

If an account member needs additional access, another account member with permissions to do so must adjust their role. To learn how, read [Changing member roles](/docs/home/account/roles/manage-role-change).

This table displays the preset organization roles and their associated permissions:

<table>
  <thead>
    <tr>
      <th>Role name</th>
      <th>Can view data</th>
      <th>Can modify data</th>
      <th>Can manage account members</th>
      <th>Can manage billing</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>LaunchDarkly Member</td>

      <td />

      <td />

      <td />

      <td />
    </tr>

    <tr>
      <td>LaunchDarkly Architect</td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td />
    </tr>

    <tr>
      <td>LaunchDarkly Admin</td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td />
    </tr>

    <tr>
      <td>LaunchDarkly Billing Admin</td>

      <td />

      <td />

      <td />

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>
    </tr>

    <tr>
      <td>Reader (base role)</td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td />

      <td />

      <td />
    </tr>

    <tr>
      <td>Writer (base role)</td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td />

      <td />
    </tr>

    <tr>
      <td>Admin (base role)</td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>
    </tr>

    <tr>
      <td>Owner (base role)</td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>

      <td>
        <Icon icon="circle-check" color="#00B701" iconType="solid" />
      </td>
    </tr>

    <tr>
      <td>No access (base role)</td>

      <td />

      <td />

      <td />

      <td />
    </tr>
  </tbody>
</table>

### Admin and Owner

Admins can do anything in LaunchDarkly except set which account member has the legacy Owner role. You can have multiple Admins in your LaunchDarkly account.

The member with the Owner base role has absolute power over your entire LaunchDarkly account, including the ability to add or remove the Admin role from other account members, or to remove the Owner role from themselves and assign it to someone else.

### Architect and Writer

Architects and Writers can manage all top-level resources, but cannot manage your payment method or plans. For example, they can modify feature flags, metrics, environments, projects, and more. Architects can also add members and update member roles.

### Billing Admin

Billing Admins can update billing information for your LaunchDarkly account.

### Reader

Readers can view information in LaunchDarkly, but can't modify it. This role is for members of your organization who need visibility into your feature flags, but should not be able to modify rollout rules or administrative settings.

### Member and No access

Members with these roles cannot access any part of the LaunchDarkly platform. This role is for members who should not be able to view or modify anything until an Admin grants them access to specific areas of LaunchDarkly.

## Update organization roles

You can update organization roles provided by LaunchDarkly in the following ways:

* You can add new policy statements to them. To learn how, read [Editing roles](/docs/home/account/roles/role-edit). You can also remove policy statements that you have added to preset roles. However, you cannot change the policy statements that are included as part of the preset roles.

* You can review and accept updates to the preset roles that are provided by LaunchDarkly. LaunchDarkly periodically updates all preset organization and project roles. For example, when new [resources](/docs/home/account/roles/role-resources) become available, the preset Admin role may be updated to include access to them.

When updates to the LaunchDarkly preset organization roles are available, account members with an Admin role receive an update notification on the **Roles** page.

To review and accept updates to the preset organization roles:

1. Click the **gear** icon in the left sidebar to view Organization settings.
2. Click **Roles**.
3. Click **View changes** from the "Updates to predefined roles" notification.
   * Only account members with a LaunchDarkly Admin role, an Admin base role, or an Owner base role receive this notification.
   * This notification only appears when new preset roles are available.
4. In the "Updated roles" dialog, review the changes to the preset roles.
5. Click **Apply all changes**.

After you apply the changes, all account members with preset roles now have updated permissions.
