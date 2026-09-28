# Production Security Notes

The included schema is designed to make the current frontend prototype easy to demonstrate after Supabase configuration. The demo policies allow browser access to the shared state row. Do not use these policies for a public production deployment.

For production:
1. Move application authentication to Supabase Auth.
2. Replace the demo policies with role- and user-specific Row Level Security policies.
3. Split the JSONB state into normalized PostgreSQL tables.
4. Never expose a service_role or secret key in browser JavaScript.
5. Add server-side or Edge Function logic for privileged operations.
