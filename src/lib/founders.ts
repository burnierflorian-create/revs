// Hardcoded user IDs of REVS founders. Surfaced on the Feed (red ring
// around the avatar) and reused anywhere else founder identity matters.
// Kept as a Set for O(1) lookup; the list is small enough that even a
// linear scan would be fine.
//
// IMPORTANT — fill these with the actual auth.users.id from Supabase
// before the next deploy. Leaving them empty just means "no founder
// rings render" — nothing breaks.
const FOUNDER_USER_IDS = new Set<string>([
  '375d719a-09a5-4ee8-b99f-df83d3d0509c', // Florian — burnier.florian13@gmail.com
  '43a86fc8-0b82-4ad5-ad92-d9d0201fc1b4', // Florian — burnierflorian@apexline92.com
  '79d1cfcb-245c-47b6-a62d-390fc51d7af2', // Niko    — nikolajagodic30@gmail.com
])

export function isFounder(userId: string | null | undefined): boolean {
  if (!userId) return false
  return FOUNDER_USER_IDS.has(userId)
}
