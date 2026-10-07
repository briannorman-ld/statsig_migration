> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# OAuth applications

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic explains how to authorize or revoke access of an OAuth app.

<Warning>
  **OAuth apps may require extensive permissions**

  It is critically important to only authorize applications you trust to use your LaunchDarkly account. Read the permissions required by the app carefully and use your own best judgment about whether you trust an app enough to use it.
</Warning>

## Connect an OAuth app to LaunchDarkly

You can connect your LaunchDarkly account to external applications, such as the LaunchDarkly Slack app, using the OAuth 2.0 protocol. When you authorize an OAuth application, you grant the application access to information and actions an account member might take. Some applications can act on your behalf, such as by turning feature flags on and off.

Your LaunchDarkly credentials and billing information will never be shared with any OAuth application you authorize.

If you are interested in developing your own OAuth application, read [Registering a LaunchDarkly OAuth client](/docs/integrations/partner-integrations/oauth-client-registration).

## OAuth app permissions

On initial authorization, an OAuth app shows you a complete list of permissions it requires to work. While the app may have the capability to perform many actions in LaunchDarkly, the app's ability to do anything is limited by the abilities of the account member who authorizes it.

Additionally, if your own permissions are reduced, applications you have previously authorized will have reduced permissions as will.

<Note>
  **When you authorize an OAuth app, it can never do more than you can do**

  For example, if you are have a Writer base role and authorize an app, and then are downgraded to a Reader base role, your app will only have Reader-level permissions.
</Note>

## Disconnect an OAuth app

We care about the security of your information. You or an Administrator can revoke an app's permission to use your account at any time.

<Note>
  **Administrators can revoke any app**

  If you are a LaunchDarkly administrator, you can revoke access of any app added to LaunchDarkly, regardless of which account member added it.
</Note>

To disconnect an app:

1. Click the **gear** icon in the left sidebar to view Organization settings.
2. Click **Authorization** from the left sidebar.
3. Click the **OAuth applications** tab and locate the app you would like to disconnect.
4. Click the **three-dot** overflow menu for the app.
5. Select **Revoke application**. The "Revoke access" dialog appears.
6. Enter the name of the app in the confirmation field.
7. Click **Revoke**.

The application's access is revoked.
