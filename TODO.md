Create "statistics" page where it shows both local records and both global records
Create global leaderboard logic and provide DB config txt file.
Records in global leaderboard must be saved with Guest1, Guest2... if user is not logged in but if it is logged in, save them with user's username. Create accounts with magic link option using supabase.
Instead of using supabase url and supabase anon key, use enviromental variables.
Q: What should users authenticate with for the global leaderboard? Supabase supports email/password, magic link (passwordless email), OAuth (Google, GitHub, etc.), or anonymous auth.
A: Magic link (email) - Passwordless - user enters email, clicks link sent to inbox
Q: What information should the global leaderboard display per entry?
A: Username + time + country - Display name, best time, and player's country/location
Q: How should the statistics page be accessed from the main menu?
A: New menu button - Add a 'Statistics' button to the main menu alongside Play, Settings, Credits
Q: Should the leaderboard show a top N ranking, or infinite scroll? And how many entries?
A: Show top 50 best times per difficulty and if user wants to see more he only has to click "show more"