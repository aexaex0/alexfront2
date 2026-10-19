/**
 * Name censoring is turned off in this fork: usernames and clan tags are
 * shown exactly as the player typed them. The only normalisation left is
 * upper-casing the clan tag, which the rest of the code relies on.
 */
export function censorPlayer(
  username: string,
  clanTag: string | null,
): { username: string; clanTag: string | null } {
  return { username, clanTag: clanTag ? clanTag.toUpperCase() : null };
}
