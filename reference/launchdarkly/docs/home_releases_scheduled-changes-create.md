> ## Documentation Index
> Fetch the complete documentation index at: https://launchdarkly.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Creating scheduled flag changes

<View title="Developer" />

<View title="Federal docs" />

<View title="EU docs" />

This topic explains how to create scheduled flag changes to take effect at a date in the future.

## Create scheduled flag changes

To schedule a set of flag changes:

1. Click **Code**. The CodeControl menu appears.
2. Click **Flags**.
3. Select the flag for which you want to schedule targeting changes. The flag's **Targeting** tab appears.
4. Make the changes you want to the flag's targeting.
5. Click **Review and save**. The "Save changes" dialog appears.
6. Review the changes displayed in the dialog.
7. (Optional) Click the **calendar** icon to schedule the change.
   1. Select a date, time, and timezone.
   2. Click **Update**.
8. Click the **person** icon to open the **Save changes** menu.
9. (Optional) Choose one or more reviewers from the **Reviewer(s)** menu if your environment requires approvals for flag changes.
10. Enter a **Comment** to add details that help your reviewers understand the changes you made.
11. **Confirm** your changes by entering the name of your environment.
12. Depending on the choices you made, click **Schedule changes** or **Request approval**.

You can schedule multiple changes for different dates and times for a single flag. For example, you can implement a progressive rollout strategy by scheduling multiple sequential changes to targeting rules.

Here is an image of a flag with multiple changes scheduled:

<Frame caption="A flag with multiple changes scheduled.">
  <img src="https://mintcdn.com/launchdarkly/ppwc2LYsjE8wwIC_/images/auto/workflows-pending-changes.auto.png?fit=max&auto=format&n=ppwc2LYsjE8wwIC_&q=85&s=dc58741493357afdd9f56f3c5087170d" alt="A flag with multiple changes scheduled." width="568" height="460" data-path="images/auto/workflows-pending-changes.auto.png" />
</Frame>

If you use scheduled flag changes to schedule context removal dates, but an approver approves the request *after* the scheduled date and time of the context removal, LaunchDarkly prevents you from applying the change. To learn more about scheduling, read [Schedule context removal from segments](/docs/home/flags/rule-based-segments#schedule-context-removal-from-segments).

<Card icon="https://mintcdn.com/launchdarkly/YIC2H8XW-fomhquw/assets/icons/openapi-logo.svg?fit=max&auto=format&n=YIC2H8XW-fomhquw&q=85&s=dd9578a9668a86e1a8b8c314921f204c" horizontal width="2500" height="2452" data-path="assets/icons/openapi-logo.svg">
  You can also use the REST API: [Create scheduled changes workflow](/docs/api/scheduled-changes/create-scheduled-changes-workflow).
</Card>

## Create scheduled flag changes that require approvals

Enterprise customers can require approvals for scheduled flag changes. If approvals are required, the change is marked "Pending Review" in the "Pending changes" panel.

If there are conflicts between changed flags and requested changes, approved and applied changes take precedence over pending or requested changes. To learn more, read [Manage conflicts with scheduled changes](/docs/home/releases/scheduled-changes-manage#manage-conflicts-with-scheduled-changes).
