> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# LaunchDarkly in federal environments

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic explains how the version of LaunchDarkly that is available on domains controlled by the United States government is different from the version of LaunchDarkly available to the general public. If you are an employee or contractor for a United States federal agency and use LaunchDarkly in your work, you likely use the federal instance of LaunchDarkly. This instance is compliant with the United States government's Federal Risk and Authorization Management Program (FedRAMP).

To maintain FedRAMP compliance, the LaunchDarkly federal instance uses enhanced infrastructure and security configurations compared to the generally available instance of LaunchDarkly. Many components that function automatically in the generally available instance instead use encryption, authentication, or require authorization to perform functions in the federal instance. In addition, third-party components that are federally compliant, such as AWS and Datadog, have policies and agents enabled to maintain compliance when connecting to LaunchDarkly.

## The federal version of this docs site

You can view a federal instance-specific version of this documentation site.

The federal version of the docs site is different from the standard version in the following ways:

* Federal instance URLs display with `.us` URLs, including within code samples. To learn more, read [Federal instance URLs](#federal-instance-urls).
* Features and integrations that the federal instance does not support are marked with a warning message. To learn more, read [Supported features](#supported-features).

To open or review the federal instance-specific version of this documentation site, change the site version menu to "Federal docs":

<Frame caption="The site version menu with &#x22;Federal docs&#x22; selected.">
  <img src="https://mintcdn.com/launchdarkly/7dOLLfhGme_BglBp/images/__not_from_LD_app_UI/federal-version-menu.png?fit=max&auto=format&n=7dOLLfhGme_BglBp&q=85&s=64e00c8dc746848270e1fd68a8d4e080" alt="The site version menu with &#x22;Federal docs&#x22; selected." width="800" height="110" data-path="images/__not_from_LD_app_UI/federal-version-menu.png" />
</Frame>

## Features available in the federal instance

The LaunchDarkly federal instance has near-parity with the generally available LaunchDarkly instance. There are some exceptions, which are explained below.

### Supported features

The federal instance supports the following features:

* Core flagging features through the LaunchDarkly application and [API](/docs/api)
* [Code references](/docs/home/flags/code-references), if the `ld-find-code-refs` utility is [compiled with FIPS 140-3 support](/docs/home/flags/code-references#code-references-in-federal-environments)
* Customer metrics
* [Data Export](/docs/integrations/data-export) to [Amazon Kinesis](/docs/integrations/data-export/kinesis)
* [Experimentation](/docs/home/experimentation), except for Snowflake native Experimentation
* [The local MCP server](/docs/home/getting-started/mcp-local)
* [The Relay Proxy](/docs/sdk/relay-proxy)
* Most [SDKs](/docs/sdk), except for edge SDKs and the Roku SDK
* [Single sign-on](/docs/home/account/sso)

The federal instance does not support the following features:

* [AgentControl](/docs/home/agentcontrol)
* [Collecting user feedback](/docs/home/releases/user-feedback)
* [Debugging guarded rollout errors](/docs/home/releases/errors)
* [Edge SDKs](/docs/sdk/edge)
* Data Export to destinations other than Amazon Kinesis
* [Inbox notifications for approval requests](/docs/home/releases/approval-reviews#view-approval-requests-from-your-in-app-inbox)
* [Launch Insights](/docs/home/getting-started/launch-insights)
* [Live events](/docs/home/releases/live-events)
* [The hosted MCP server](/docs/home/getting-started/mcp-hosted)
* [Migration flags](/docs/home/flags/migration)
* Some mobile lifecycle features are partially supported. Federal customers cannot target based on supported or unsupported status, and do not have applications created automatically. To learn more about these features, read [Applications and application versions](/docs/home/releases/apps-and-app-versions).
* [Observability](/docs/home/observability)
* [The Roku SDK](/docs/sdk/client-side/roku)
* [Snowflake native Experimentation](/docs/home/warehouse-native/snowflake)
* The [support chatbot](/docs/home/getting-started/feature-management#additional-resources)
* [Vega](/docs/home/getting-started/vega)

### Supported integrations

Integrations connect LaunchDarkly to other systems and move data between them. However, not all of the following connected systems are FedRAMP-authorized, so you may need additional approvals from your FedRAMP sponsor to use them. It is your responsibility as a LaunchDarkly customer to ensure that any systems you connect to LaunchDarkly are authorized appropriately.

The federal instance supports the following integrations:

* [Amazon Kinesis data export](/docs/integrations/data-export/kinesis)
* [AppDynamics](/docs/integrations/appdynamics)
* [Datadog](/docs/integrations/datadog)
* [Dynatrace](/docs/integrations/dynatrace)
* [Elastic (ELK) Stack](/docs/integrations/elastic-stack)
* [Github Actions](/docs/integrations/github-actions)
* [Grafana](/docs/integrations/grafana)
* [Honeycomb](/docs/integrations/honeycomb)
* [IntelliJ IDEA plugin](/docs/home/getting-started/intellij)
* [Mezmo](/docs/integrations/mezmo)
* [Microsoft Teams incoming webhooks](/docs/integrations/microsoft-teams/webhooks)
* [New Relic One](/docs/integrations/new-relic)
* [Okta](/docs/home/account/okta)
* [PagerDuty](/docs/integrations/pagerduty-guardian-edition)
* [Slack incoming webhooks](/docs/integrations/slack/webhooks)
* [Splunk](/docs/integrations/splunk)
* [Splunk Observability Cloud](/docs/integrations/splunk-observability)
* [Terraform](/docs/integrations/terraform)
* [Twilio Segment](/docs/integrations/metric-segment)

The federal instance does not support any other LaunchDarkly integrations.

## Federal instance URLs

The federal instance, including the LaunchDarkly application, the federal instance API, and some SDK initialization option settings, does not use the standard `.com` URL path. Instead, it uses the US government's `.us` URL path. If application or network layer firewalls are in use on your network, allowlist these URLs so LaunchDarkly functions properly.

These URLs include:

* `https://app.launchdarkly.us`
* `https://clientsdk.launchdarkly.us`
* `https://clientstream.launchdarkly.us`
* `https://events.launchdarkly.us`
* `https://sdk.launchdarkly.us`
* `https://stream.launchdarkly.us`

To learn how to configure your SDK correctly using these endpoints, read [Service endpoint configuration](/docs/sdk/features/service-endpoint-configuration).

## Initialize an SDK for the federal instance

You can initialize an SDK for the federal instance using the initialization options for the SDK.

Depending on the SDK, you may need to configure multiple service endpoints in the initialization options. These could include the base and polling endpoint, streaming endpoint, and events endpoint. Server-side SDKs normally require streaming and events settings, not polling. For a list of available service endpoints, read [Federal instance URLs](#federal-instance-urls).

The details of how to set these options differ between SDKs, as LaunchDarkly respects each language's URI and URL naming conventions and supported services. For this reason, it is critical to reference the documentation for each individual SDK.

<Card icon="rectangle-terminal" horizontal>
  Configure your SDK: [Service endpoint configuration](/docs/sdk/features/service-endpoint-configuration)
</Card>

## Use open source LaunchDarkly components with FIPS 140-3 encryption

If you are using the LaunchDarkly [Relay Proxy](/docs/sdk/relay-proxy) or [code references](/docs/home/flags/code-references), you may need to take additional steps to ensure these components are using FIPS 140-3 validated encryption modules. The LaunchDarkly federal instance uses FIPS 140-3 validated encryption modules in all applicable places. To learn more, read [LaunchDarkly in environments requiring FIPS 140-3 validated encryption modules](/docs/home/infrastructure/fips-140-3-encryption).
