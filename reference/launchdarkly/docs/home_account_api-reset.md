> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# API access token expiration dates

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic explains how to add expiration dates to API access tokens. You may need to add expiration dates to access tokens if your organization's security policies require that you regularly rotate API access tokens, or if you have personnel changes in your organization.

<Tip>
  **Rotate your tokens regularly**

  As a best practice, we recommend rotating your tokens regularly to prevent tokens from becoming outdated, such as when account members leave. If you remove an account member from your account, their personal API access tokens become invalid. We recommend updating integrations to use new access tokens before removing account members.
</Tip>

## Add expiration dates to API access tokens

Setting an expiration date on an API access token lets you plan ahead for token rotation without needing to manually delete the token later. The token remains active until the expiration date, giving you time to update your clients before it stops working.

Before you add an expiration date to a current API access token, create a new token to move your clients to.

To add an expiration date to an API access token:

1. Click the **gear** icon in the left sidebar to view Organization settings.
2. Click **Authorization**. The **Tokens** tab appears.
3. Click the **three-dot** overflow menu for the token and select **Edit token**. The "Edit \[token]" panel appears.
4. Click the **Expiration** menu and select an expiration period of 7, 30, 60, or 90 days, or choose a custom date.
5. Click **Save token**.

Update any clients to use a [new token](/docs/home/account/api-create) before the current token expires.
