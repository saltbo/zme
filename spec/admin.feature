Feature: Admin connectors
  Administrators manage external connectors (media sources, indexers, downloaders).
  Connector config is stored; credentials never appear in list/summary responses.

  @admin/media-source-crud @api
  Scenario: An administrator manages a media source without leaking credentials
    Given an authenticated administrator
    When they create, fetch, update, and delete a media source
    Then each step succeeds and summary responses omit credentials

  @admin/downloader-crud @api
  Scenario: An administrator manages downloaders scoped to their own user
    Given an authenticated administrator
    When they create, list, and delete a downloader
    Then each step succeeds and only their own downloaders are listed
