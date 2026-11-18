/**
 * ACCOUNTS THE STATION HIDES FROM ITS ROSTER SCREENS.
 *
 * Owner request (2026-11-14, grown since): a username in this list never renders
 * on the directory (User management), the "Who's connected now" board, or the
 * dashboard's Users card — in neither view, under no filter, and out of the
 * counts those screens derive from the same rows. A DEACTIVATED account still
 * shows (red, and still countable); these do not show at all.
 *
 * ONE HOME, because the copy that gets forgotten is the account that keeps
 * showing up on a screen nobody checked. Every screen that draws people reads
 * this list instead of keeping its own.
 *
 * Matched by username, which the server holds unique. Delete a name here and the
 * account is back everywhere.
 */
export const HIDDEN_USERNAMES = ['e.ramos', 'm.santos', 'preview.probe2', 'playtest.probe3'];
