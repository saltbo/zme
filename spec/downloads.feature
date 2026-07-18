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
