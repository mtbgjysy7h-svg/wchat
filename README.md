# LinkChat Persistent — Ready to Deploy

This build is already connected to the configured Supabase backend.

Features:
- Email/password accounts
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

If Supabase email confirmation is enabled, new users must confirm their email before signing in. If you want instant account creation for testing, disable email confirmation in Supabase Auth settings.

## Delete chat behavior

Deleting a chat clears the visible history only for the user who deletes it. The friend remains on the friends list, and new messages continue normally.

## Security

The frontend uses only the Supabase publishable key. It does not contain a service-role/secret key. Database rows and private image storage are protected with Row Level Security policies.
