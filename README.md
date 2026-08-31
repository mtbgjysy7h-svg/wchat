# LinkChat Persistent — Ready to Deploy

This build is already connected to the configured Supabase backend.

Features:
- Username/password accounts — no student email required
- Unique usernames
- Friend requests
- Persistent friends list
- Saved text messages
- Saved picture messages
- Live updates
- Delete chat for yourself while keeping the friend
- Responsive mobile/desktop layout

## Deploy to Vercel

Open a terminal inside this exact folder, where `index.html` is visible, and run:

```bash
npx vercel --prod
```

No build command is needed.

## Account notes

Students only see a username + password form. LinkChat creates a hidden internal Supabase identity on the server, auto-confirms it, and never sends a confirmation email.

Because students do not provide an email or phone number, normal self-service password recovery is intentionally unavailable. A forgotten password must be reset by an administrator.

## Delete chat behavior

Deleting a chat clears the visible history only for the user who deletes it. The friend remains on the friends list, and new messages continue normally.

## Security

The frontend uses only the Supabase publishable key. It does not contain a service-role/secret key. Database rows and private image storage are protected with Row Level Security policies.
