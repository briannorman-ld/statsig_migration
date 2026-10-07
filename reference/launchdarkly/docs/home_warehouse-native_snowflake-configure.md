> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Setting up the Snowflake integration

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

<View title="Federal docs">
  <Danger>
    **Snowflake native Experimentation is not available in federal environments**

    To learn more, read <a href="/docs/home/infrastructure/federal">LaunchDarkly in federal environments</a>.
  </Danger>
</View>

<Note>
  **Contact us for help with configuring Snowflake native Experimentation**

  Access to Snowflake native Experimentation requires both [Data Export](/docs/integrations/data-export) and [Experimentation](/docs/home/experimentation). If you do not have access or need help getting started, contact your LaunchDarkly representative or [start a Support ticket](https://support.launchdarkly.com/hc/en-us/requests/new).
</Note>

<Warning>
  **Snowflake native Experimentation works only with LaunchDarkly experiment data**

  You cannot run Snowflake native experiments on experiment data coming from third-party sources, or flag evaluation data from LaunchDarkly that was not generated as part of a LaunchDarkly experiment.
</Warning>

This topic explains how to set up the Snowflake native Experimentation integration.

## Prerequisites

To configure the Snowflake integration, you must have the following prerequisites.

### Snowflake data requirements

Before you begin, prepare your Snowflake data to meet the [Snowflake data requirements](/docs/home/warehouse-native/snowflake-requirements) for the integration.

### Role permissions

The role permission requirements include:

* You must have the `ACCOUNTADMIN` role in Snowflake
* You must have a [LaunchDarkly role](/docs/home/account/roles) of Owner or Admin, or a custom role that allows the following actions:
  * [add and edit integrations](/docs/home/account/roles/role-actions#integration-actions)
  * [add destinations](/docs/home/account/roles/role-actions#destination-actions)
  * [add metric data sources](/docs/home/account/roles/role-actions#metric-data-source-actions)

### IP addresses

You must add to your Snowflake allow list the following outbound IP addresses:

<View title="Developer">
  * `52.21.152.96/32`
  * `52.200.35.24/32`
  * `52.200.50.23/32`
  * `54.144.218.89/32`
  * `54.221.221.197/32`
  * `34.236.6.43/32`
</View>

<View title="EU docs">
  * `3.78.21.121/32`
  * `3.124.211.237/32`
  * `18.153.39.243/32`
  * `3.75.12.2/32`
  * `3.68.26.17/32`
  * `3.77.253.41/32`
</View>

For a full list of LaunchDarkly's public IP addresses, read [Public IP list](/docs/home/infrastructure/ip-list).

### Network policy

* If you use network policies within your Snowflake account, you will need to create or update your policy to allow traffic from LaunchDarkly. To do this, you need your LaunchDarkly project key and environment key:
  1. Find, copy, and save your project key [following these instructions](/docs/home/account/project#project-keys).
  2. Find, copy, and save your environment key [following these instructions](/docs/home/account/environment#environment-and-sdk-credentials).
  3. Combine the keys together, separated by two underscores. For example, if your project key is `MobileApp` and your environment key is `production`, your combined key is `MobileApp__production`.
  4. Replace `<ProjKey__EnvKey>` with your combined key in the code sample below, and add it to your Snowflake network policy:

<View title="Developer">
  <CodeGroup>
    ```sql title="Snowflake network policy" lines wrap theme={null}
    CREATE NETWORK RULE LD_EXPERIMENTATION.RESULT_<ProjKey__EnvKey>.LD_EXPERIMENTATION_NETWORK_RULE TYPE = IPV4 MODE = INGRESS VALUE_LIST = ('52.21.152.96/32','52.200.35.24/32','52.200.50.23/32','54.144.218.89/32','54.221.221.197/32','34.236.6.43/32');

    CREATE NETWORK POLICY LD_EXPERIMENTATION_NETWORK_POLICY ALLOWED_NETWORK_RULE_LIST=(LD_EXPERIMENTATION_NETWORK_RULE);

    ALTER USER LD_EXPERIMENTATION_USER_<ProjKey__EnvKey> SET NETWORK_POLICY = LD_EXPERIMENTATION_NETWORK_POLICY;
    ```
  </CodeGroup>
</View>

<View title="EU docs">
  <CodeGroup>
    ```sql title="Snowflake network policy" lines wrap theme={null}
    CREATE NETWORK RULE LD_EXPERIMENTATION.RESULT_<ProjKey__EnvKey>.LD_EXPERIMENTATION_NETWORK_RULE TYPE = IPV4 MODE = INGRESS VALUE_LIST = (`3.78.21.121/32`,`3.124.211.237/32`,`18.153.39.243/32`,`3.75.12.2/32`,`3.68.26.17/32`,`3.77.253.41/32`);

    CREATE NETWORK POLICY LD_EXPERIMENTATION_NETWORK_POLICY ALLOWED_NETWORK_RULE_LIST=(LD_EXPERIMENTATION_NETWORK_RULE);

    ALTER USER LD_EXPERIMENTATION_USER_<ProjKey__EnvKey> SET NETWORK_POLICY = LD_EXPERIMENTATION_NETWORK_POLICY;
    ```
  </CodeGroup>
</View>

## Step 1: Gather your Snowflake account information

To begin, collect the following information about your Snowflake account:

* The name of the Snowflake database containing your metrics data. LaunchDarkly will be granted read access to this database.
* The name of the schema within your metrics database. You don't need this if you want to grant access to all schemas within the database.

## Step 2: Configure the Snowflake Data Export integration

<Note>
  **You must be using the latest version of the Snowflake Data Export integration**

  If you were using an earlier version of Snowflake Data Export, you must update it to the version released in January 2025.
</Note>

To begin, configure the latest Snowflake Data Export integration. The Snowflake Data Export integration provides LaunchDarkly experiment exposure data to Snowflake. This data is used with your metric events data stored in Snowflake to compute experiment results.

Follow the installation instructions at [Snowflake Data Export](/docs/integrations/data-export/snowflake) to configure the Snowflake Data Export integration. You can also view a 6-minute [instructional video about Snowflake Data Export Setup](https://youtu.be/yCW0gAbVZqo).

## Step 3: Configure the Snowflake native Experimentation integration

Now, you will configure the Snowflake native Experimentation integration in LaunchDarkly. This integration is a second LaunchDarkly integration that looks similar to the Snowflake Data Export integration, but requires a separate setup process.

To set up the Snowflake native Experimentation integration:

1. Navigate to the [**Integrations**](https://app.launchdarkly.com/settings/integrations) page.
2. Search for and select **Snowflake Native Experimentation**.
3. Click **Add integration**. The [configuration panel](https://app.launchdarkly.com/settings/integrations/snowflake-experimentation/new) appears.
4. Enter an integration **Name**.
5. Select the LaunchDarkly **Project and environment** for this integration. You cannot change this after you save the integration.

<Frame caption="The Snowflake Native Experimentation configuration panel in LaunchDarkly.">
  <img src="https://mintcdn.com/launchdarkly/A4UXoRTW8ATNw4yq/images/auto/snowflake-native-exp-config.auto.png?fit=max&auto=format&n=A4UXoRTW8ATNw4yq&q=85&s=c9443f302e199cea488773591b27c9be" alt="The Snowflake Native Experimentation configuration panel in LaunchDarkly." width="1854" height="1840" data-path="images/auto/snowflake-native-exp-config.auto.png" />
</Frame>

6. Enter your Snowflake **Metrics database name**.
7. (Optional) Enter your Snowflake **Metrics schema name**.
8. LaunchDarkly generates a **SQL** script. Copy and save this script for use in the next step.

Keep the configuration screen open, as you will return to it in a later step.

### Run the SQL script in Snowflake

Next, run the SQL script in Snowflake:

1. In Snowflake, navigate to **Projects / Worksheets**.
2. Click the + "Create SQL worksheet" button to create a new worksheet.
3. Paste the generated script to the worksheet.
4. Click the **arrow** to run the worksheet.

### Save the configuration in LaunchDarkly

To finish the configuration in LaunchDarkly:

1. Return to the LaunchDarkly configuration screen.
2. Click **Test connection and save**.

## Step 4: Create a metric data source

Now, you can set up your metric data source in LaunchDarkly by following the steps under [Create data sources](/docs/home/warehouse-native/metric-data-sources#create-data-sources).

## Step 5: Verify the connection

Finally, verify the connection. On the integration configuration page, check the "Connection status" indicator. A green **Healthy** status confirms LaunchDarkly can connect to Snowflake and has the correct permissions.

## Next steps

Read the following topics to understand how to create an experiment using a Snowflake native metric and how to analyze the experiment results:

* [Creating experiments using warehouse native metrics](/docs/home/warehouse-native/creating)
* [Analyzing experiments](/docs/home/experimentation/analyze)

The results page for an experiment using warehouse native metrics displays the date and time the results were last updated from Snowflake. The initial load of experiment results can take up to 60 minutes to appear, and further results updates appear within 15–30 minutes.
