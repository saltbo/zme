Feature: Download monitoring
  A user can monitor active download tasks without leaving the Downloads page.

  @downloads/live-task-monitoring @web
  Scenario: Live snapshots update a running download card
    Given the Downloads page shows a running task
    When successive snapshots report different downloaded bytes and download speed
    Then the card updates its speed and progress without navigation or a manual refresh

  @downloads/monitor-context @web
  Scenario: Live snapshots preserve the current monitoring context
    Given the Downloads page has loaded multiple pages from multiple downloaders
    When a snapshot updates a task in the all or matching status-filtered view
    Then the loaded pages, active filter, and tasks from other downloaders remain visible

  @downloads/live-task-monitoring @web
  Scenario: Live snapshots reconcile the task collection
    Given the Downloads page is connected to the live task stream
    When a snapshot adds, removes, or changes the status of a task
    Then the active task list is reconciled without a manual refresh

  @downloads/live-task-monitoring @web
  Scenario: Changing the status filter preserves the live connection
    Given the Downloads page is connected to the live task stream
    When the user changes the status filter
    Then the page continues with the existing browser event stream

  @downloads/live-task-monitoring @api
  Scenario: One unhealthy downloader does not stop live updates
    Given multiple downloaders provide live task events
    When one upstream event stream disconnects
    Then its connection is retried independently while other downloaders continue updating
