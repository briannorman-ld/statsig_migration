> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Metric data sources

<View title="Developer" />

<View title="Federal docs">
  <Danger>
    **Experiments using warehouse native metrics are not available in federal environments**

    To learn more, read <a href="/docs/home/infrastructure/federal">LaunchDarkly in federal environments</a>.
  </Danger>
</View>

<View title="EU docs" />

This topic explains how to create metric data sources for warehouse native metrics.

Metric data sources allow you to bring multiple data tables directly from your external warehouse into LaunchDarkly, without requiring you to centralize your data in a single, all-events table. This lets you add multiple tables as a data source to better match how you have organized your data warehouse.

## Prerequisites

To create a metric data source in the LaunchDarkly UI:

* You must have an existing warehouse native Experimentation integration. To learn more, read [Setting up external warehouses](/docs/home/warehouse-native/warehouses).

### Snowflake-specific prerequisites

If you are using Snowflake, you must have the `LD_DATA_SOURCE_ROLE` role in Snowflake. You create this role when you set up the Snowflake Native Experimentation integration. If you modify the native-app-provided SQL before you run it, be sure that this role has read-only access to your metric events tables, schemas, and databases, and no other resources.

When LaunchDarkly calculates your experiment results, it will execute your data source query using the role `LD_EXPERIMENTATION_ROLE`.

## Create data sources

When you create a new metric data source from your warehouse tables, you must map your warehouse table columns to the schema that LaunchDarkly needs to create a metric and run an experiment.

To create a data source:

1. Open the **Data** section and navigate to the **Data sources** list.
2. Click **Create metric source**.
3. Enter a data source **Name** in the "Name your data source" section.
4. (Optional) Add a **Description**.
5. Click **Select warehouse integration** in the "Define data source" section and choose the integration for a specific LaunchDarkly project and environment.
6. Enter a SQL query against one or more tables to return all metric events you want to include in this data source. The query should return data from all columns that provide required ID types to LaunchDarkly. These include a timestamp, an event key such as `purchase` or `button click`, an event value (can be `null`), and at least one column identifying the event's context, such as `user_id` or `device_id`.
7. Click **Run query**.
8. Map your warehouse table columns to fields in LaunchDarkly in the "Map your data in LaunchDarkly" section:
   * **Timestamp**: Map to the timestamp when the event occurred. Choose a column that uses the timestamp or datetime format and encodes timezone information, to ensure that metric events are attributed correctly relative to experiment context exposures.
   * **Context key**: Map to one of your context kinds defined in LaunchDarkly. For example, you can map a "user\_id" column to the launchdarkly "user" context.
     * (Optional) Click **Add another context pair** to add another key/kind pair. For Snowflake data sources, you can use additional mapped columns for filtering custom events when you create metrics from this data source. To learn more, read [Filtering custom metric events](/docs/home/metrics/event-filters).
   * **Event value**: Map to a numeric value representing the event’s measurement, such as `order_amount`, or `1` for conversion events.
   * **Event key**: Map to the key of the event type, such as `purchase`, `add to cart`, or `page view`.
9. Click **Save configuration**.

## Edit data source configurations

To edit an existing data source:

1. Open the **Data** section and navigate to the **Data sources** list.
2. Click the **three-dot** overflow menu for the data source you want to archive.
3. Select **Edit configuration**. The "Configuration" tab opens.
4. Make any changes as needed and click **Save configuration**.

## Archive data sources

You can archive a data source when you no longer need it. Archiving a metric data source does not make changes to the warehouse integration it is linked to.

To archive a data source:

1. Open the **Data** section and navigate to the **Data sources** list.
2. Click the **three-dot** overflow menu for the data source you want to archive.
3. Select **Archive**.

To view archived data sources, click the **Type** menu and select **Archived**.
