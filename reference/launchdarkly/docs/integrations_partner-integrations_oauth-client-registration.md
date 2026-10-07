> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Registering a LaunchDarkly OAuth client

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic explains how to register a LaunchDarkly OAuth 2.0 client so you can develop your own applications with secure delegated access to LaunchDarkly.

## Create and register a LaunchDarkly OAuth client

Registering a LaunchDarkly OAuth client allows you to build custom integrations that let members log into your application with their LaunchDarkly account. To learn more, read [Using the LaunchDarkly integration framework](/docs/integrations/building-integrations).

You must have Admin privileges or an access token created by a member with Admin privileges that grants you permission to the `acct` resource.

You can create and manage LaunchDarkly OAuth clients using the [LaunchDarkly OAuth2 client API](/docs/api/oauth2-client). This API acknowledges creation of your client with a response containing a unique `_clientSecret`. If you lose your client secret, you will have to register a new client. LaunchDarkly does not store client secrets in plain text.

<Warning>
  **Store your client secret in a secure place**

  It is critically important that you store your client secret securely. Access to the client secret would allow attackers to read and modify LaunchDarkly data on behalf of the team members who have authorized your application.
</Warning>

LaunchDarkly OAuth clients do not support multiple redirect URIs or URIs with query parameters.

<Note>
  **Non-standard redirect URIs**

  LaunchDarkly verifies submitted redirect URIs against the standard HTTP protocol format. If you wish to register a client with a redirect URI that does not conform to the HTTP protocol, [start a Support ticket](https://support.launchdarkly.com/hc/en-us/requests/new).
</Note>

## Verify a LaunchDarkly OAuth client

By default, LaunchDarkly OAuth clients are unverified, meaning they provide identity verification only to members of your LaunchDarkly organization. LaunchDarkly offers partners the option to "verify" an OAuth client to allow people outside of your LaunchDarkly organization to log in with their LaunchDarkly account. If you wish to implement a verified LaunchDarkly OAuth client, visit the [Partners page](https://launchdarkly.com/partner-program/) to become a LaunchDarkly partner.
