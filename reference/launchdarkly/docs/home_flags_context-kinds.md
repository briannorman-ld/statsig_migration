> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Context kinds

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic explains what context kinds are and how to use them. Context kinds let you group context attributes together conceptually. When you create individual targets or add targeting rules for a flag or a segment, the available context attributes are organized by context kind.

To learn how to create and manage context kinds, read [Creating and editing context kinds](/docs/home/flags/context-kinds-create) and [Archiving context kinds](/docs/home/flags/context-kinds-archive).

## About context kinds

Contexts are people, services, machines, or other resources that encounter feature flags in your product.

Each context has one or more context kinds that you can use to categorize context instances for targeting and Experimentation.

The most common context kind is `user`. User contexts often include context attributes like name, email address, location, and so on. However, you can create other context kinds like `organization` or `device`. An `organization` context kind might include attributes like "name" or "address," and a `device` context kind might include attributes like "type" or "operating system."

### Example context: Anna at Global Health Services

Anna is a doctor who works for a hospital chain called Global Health Services. Anna has two mobile devices, an Android phone and an iPad tablet. Anna uses your application on both devices as part of her work.

We can describe the information about Anna using three different context kinds:

* her name, email, and job function ("doctor") are part of a "user" context,
* her organization's name ("Global Health Services") and address are part of an "organization" context,
* her device's type, operating system, and device ID are part of a "device" context.

Here is an example of what the data structure for a user, an organization, and a device context object might look like, though each SDK sends context data to LaunchDarkly in a slightly different format:

<CodeGroup>
  ```json title="Example organization and device contexts" expandable lines wrap theme={null}
  // a user context
  {
    "kind": "user",
    "key": "example-user-key",
    "name": "Anna",
    "email": "anna@globalhealthexample.com",
    "jobFunction": "doctor"
  }

  // an organization context
  {
    "kind": "organization",
    "key": "example-organization-key",
    "name": "Global Health Services",
    "address": {
      "street": "123 Main Street",
      "city": "Springfield"
    }
  }

  // a device context
  {
    "kind": "device",
    "key": "example-device-key",
    "type": "iPad",
    "operating_system": "iPadOS 15",
    "deviceId": 12345
  }
  ```
</CodeGroup>

## Create new context kinds

When you create a new context kind, you provide only a name, key, and description. When your SDKs send a context object of that kind to LaunchDarkly, any attributes the SDK sends are automatically stored with the context.

You do not need to define any context attributes associated with a context kind when you create it. Instead, your SDK will send context attributes to LaunchDarkly along with the context object. To learn more, read [Context attributes](/docs/home/flags/context-attributes).

Context kinds are specific to LaunchDarkly [projects](/docs/home/account/project). After you create them in a project, they are available in any of the [environments](/docs/home/account/environment) within that project.

To learn how to create context kinds, read [Creating and editing context kinds](/docs/home/flags/context-kinds-create).

## Grouping context kinds together into multi-contexts

You can combine multiple contexts of different kinds together into a multi-context. Multi-contexts allow you to evaluate different, but related, contexts together.

For example, using multi-contexts a flag could target all doctors (a user context kind) using iPads (a device context kind) in Springfield (an organization context kind). To learn how, read [Multi-contexts](/docs/home/flags/multi-contexts).

## Built-in context kinds

The only built-in default context kind is `user`. This is the context kind targeting rules use by default and, if you use Experimentation, the default [randomization unit](/docs/home/experimentation/randomization) for experiments.

<Note>
  **Automatic environment attributes enable additional built-in context kinds**

  If you enable automatic environment attributes in a mobile SDK, the built-in context kinds `ld_device` and `ld_application` also become available after your SDK begins sending this information to LaunchDarkly. To learn how to enable automatic environment attributes, read [Automatic environment attributes](/docs/sdk/features/environment-attributes).
</Note>

## Context keys

Each context has a `key`. Each combination of `kind` and `key` must be unique across all your contexts. Other context attributes can be strings, booleans, numbers, arrays, or JSON objects. When you evaluate a feature flag within your application, the flag's targeting rules use information from one or more kinds of contexts. When you build your targeting rules, the attributes are automatically organized by context kind. To learn more, read [Target with flags](/docs/home/flags/target).

When you use the LaunchDarkly SDK to evaluate a flag, you provide an evaluation context to that call.

<Card icon="rectangle-terminal" horizontal>
  Configure your SDK: [Context configuration](/docs/sdk/features/context-config), [Flag variation evaluation](/docs/sdk/features/evaluating)
</Card>

After different contexts encounter your application, you can view them on the **Contexts** list. To learn more, read [The Contexts list](/docs/home/flags/contexts-list).
