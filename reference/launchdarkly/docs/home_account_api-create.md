> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Creating API access tokens

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic explains how to create API access tokens. These are required to authenticate with the [LaunchDarkly REST API](/docs/api) and are one of the options to authenticate with the [LaunchDarkly CLI](/docs/home/getting-started/ldcli).

<Note>
  **API access tokens are private**

  Only you have access to the secret values of tokens you create. Other account members cannot access them. Administrators can delete your tokens, but cannot view their values.
</Note>

You can create an API access token from the Authorization page.

By default, API tokens are personal tokens. You can choose to create a service token instead during the token creation workflow.

<Danger>
  **Save new tokens immediately**

  Your API access token is visible one time, immediately after you create it. If you leave or refresh the page where the token is displayed, it will be obscured and no longer visible. You must copy and store new access tokens somewhere secure before you leave the creation page, or you will lose access to the tokens.
</Danger>

Here is a screenshot of the "Access tokens" section of the **Authorization** page:

<Frame caption="The Access tokens list with an obscured access token called out.">
  <img src="https://mintcdn.com/launchdarkly/A4UXoRTW8ATNw4yq/images/auto/settings-access-tokens-obscured-callout.auto.png?fit=max&auto=format&n=A4UXoRTW8ATNw4yq&q=85&s=4c3d255bbfa3b471abfd33df35fcf241" alt="The Access tokens list with an obscured access token called out." width="2644" height="348" data-path="images/auto/settings-access-tokens-obscured-callout.auto.png" />
</Frame>

## Create access tokens

To create an access token:

1. Click the **gear** icon in the left sidebar to view Organization settings.
2. Click **Authorization**. The **Tokens** tab appears.
3. Click **Create token**. The "Create an access token" panel appears.
4. Give your token a human-readable **Name**.
5. Assign a **Role** to the token by choosing one from the menu.

* Select Reader, Writer, Admin, or Owner if you want to use a base role.
* Select **Custom** to choose another role, either one you've created or one provided by LaunchDarkly. This option is available only if your LaunchDarkly subscription includes custom roles.
* Select **Inline policy** to create a role policy that applies only to this token. To learn more, read [Create policies for roles](/docs/home/account/roles/role-create#create-policies-for-roles). This option is available only if your LaunchDarkly subscription includes custom roles.

6. Select the **API version** to assign to your token. By default, API requests you send using this token will use this API version. To learn more, read [Versioning](/docs/api#versioning).
7. (Optional) Select the **This is a service token** checkbox if you wish to create a service token. This feature is only available to customers on Enterprise plans.
8. Click **Save token**. The new token appears in the **Authorization** page.
9. Copy and save the token somewhere secure. After you leave this page, the token is obscured:

<Frame caption="A new access token with a reminder to copy and store it displayed.">
  <img src="https://mintcdn.com/launchdarkly/A4UXoRTW8ATNw4yq/images/auto/settings-access-tokens-notification.auto.png?fit=max&auto=format&n=A4UXoRTW8ATNw4yq&q=85&s=3e45b4467dd81e221a2555a48dbd6d52" alt="A new access token with a reminder to copy and store it displayed." width="1020" height="416" data-path="images/auto/settings-access-tokens-notification.auto.png" />
</Frame>

<Card icon="https://mintcdn.com/launchdarkly/YIC2H8XW-fomhquw/assets/icons/openapi-logo.svg?fit=max&auto=format&n=YIC2H8XW-fomhquw&q=85&s=dd9578a9668a86e1a8b8c314921f204c" horizontal width="2500" height="2452" data-path="assets/icons/openapi-logo.svg">
  You can also use the REST API: [Create access token](/docs/api/access-tokens/create-access-token)
</Card>

After you create a token, you can clone or delete it. You can also reset the secret values of your tokens, or adjust the scope of your personal tokens.

<Note>
  **Service token limits**

  By default, LaunchDarkly allows you to create 200 service tokens per account. You can create more upon request. To learn more, read [How to right size when you are over LaunchDarkly system resource count limits](https://support.launchdarkly.com/hc/en-us/articles/12319971362075-How-to-right-size-when-you-are-over-LaunchDarkly-system-resource-count-limits).
</Note>
