> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Creating and editing context kinds

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic explains how to create and edit context kinds.

## Create context kinds

<Note>
  **Creating context kinds requires specific permissions**

  You can only create new context kinds in the LaunchDarkly user interface (UI) if have a  role that allows the <code>createContextKind</code> action. The LaunchDarkly Project Admin, Maintainer, and Developer project roles, as well as the Admin and Owner base roles, all have this ability. To learn more, read [About member roles](/docs/home/account/members#about-member-roles) and [Context kind actions](/docs/home/account/roles/role-actions#context-kind-actions).
</Note>

You can create context kinds in the LaunchDarkly UI, or automatically when you evaluate a context using a LaunchDarkly SDK.

### Create context kinds in the UI

To create a context kind in the LaunchDarkly UI:

1. In the left sidebar, click **Code**. The CodeControl menu appears.
2. Click **Contexts**.
3. Click the **gear** icon on the right. The context kinds list appears.
4. Click **Add kind**.
5. The "New context kind" dialog appears.
6. Enter a **Name** for the context kind. This appears in the context kind list, and as a filter option in the **Contexts** list.
7. Enter a **Key** for the context kind. You cannot change this later. It appears in the **Contexts** list and on the [context details page](/docs/home/flags/context-details) in the "Attributes" section.
8. (Optional) Enter a **Description** for the context kind.
9. (Optional) Uncheck the **Available for experiments and guarded rollouts** checkbox if you don't want to use this context kind as a randomization unit in experiments and guarded rollouts. To learn more, read [Randomization units](/docs/home/experimentation/randomization).
   * (Optional) Check the **Set as the default for experiments** checkbox if you want new experiments and guarded rollouts to default to this context kind as the randomization unit.
10. Click **Create kind**.

### Create context kinds from an SDK

To create a context kind automatically, create a context object in your LaunchDarkly SDK. When you evaluate a flag for the context, LaunchDarkly automatically creates a new context kind for that context's kind, if one of the same name does not already exist.

<Card icon="rectangle-terminal" horizontal>
  Try it in your SDK: [Flag variation evaluation](/docs/sdk/features/evaluating)
</Card>

<Card icon="https://mintcdn.com/launchdarkly/YIC2H8XW-fomhquw/assets/icons/openapi-logo.svg?fit=max&auto=format&n=YIC2H8XW-fomhquw&q=85&s=dd9578a9668a86e1a8b8c314921f204c" horizontal width="2500" height="2452" data-path="assets/icons/openapi-logo.svg">
  You can also use the REST API: [Create or update context kind](/docs/api/contexts/create-or-update-context-kind)
</Card>

## Edit context kinds

You can edit existing context kinds from the context kinds list by clicking on the **three-dot** overflow menu next to the context kind and selecting "Edit."

You can edit the name and description of the context kind, but you cannot edit the key.

If you use [Experimentation](/docs/home/experimentation) or [guarded rollouts](/docs/home/releases/guarded-rollouts), you can also edit whether the context kind is available for these features, and whether the context kind should be the default for experiments and guarded rollouts. To learn more, read [Randomization units](/docs/home/experimentation/randomization).
