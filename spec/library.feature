Feature: Library
  A user's saved/watched media, keyed by media key.

  @library/list-states @web
  Scenario: The library reflects the saved/watched state of the user's items
    Given a user with saved items
    When the library loads
    Then each item reports its saved/watched status

  @library/save-resource @web
  Scenario: Saving an unsaved item marks it as saved
    Given an authenticated user and an item not in their library
    When they save the item
    Then the item is listed as saved

  @library/watch-resource @web
  Scenario: Marking an item watched records it as watched and saved
    Given an authenticated user
    When they mark an item watched
    Then the item reports the watched status

  @library/remove-resource @web
  Scenario: Removing a saved item drops it from the library
    Given a user with a saved item
    When they remove it
    Then the item is no longer in the library

  @library/book-music-no-tmdb @api
  Scenario: Book and music kinds are served without a TMDB source
    Given no TMDB media source is configured
    When the library is listed for the book or music kind
    Then the API returns an empty page instead of an error
