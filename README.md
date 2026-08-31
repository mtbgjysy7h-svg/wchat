# LinkChat — Messaging + Calls + Themes

This build is already connected to the configured Supabase backend and is ready for Vercel.

## Features

- Username/password accounts — no student email required
- Unique usernames
- Friend requests
- Persistent friends list
- Saved text messages
- Saved picture messages
- Live message updates
- Delete chat for yourself while keeping the friend
- 1-to-1 WebRTC voice calls
- 1-to-1 WebRTC video calls
- Incoming call screen with accept/decline
- Mute microphone, toggle camera, and hang up
- Blue, red, green, purple, and orange themes
- Theme choice saved on that browser/device
- Responsive mobile/desktop layout

## Deploy to Vercel

Open a terminal inside this exact folder, where `index.html` is visible, and run:

```bash
npx vercel --prod
```

No build command is needed.

## Accounts

Students only see a username + password form. LinkChat creates a hidden internal Supabase identity on the server, auto-confirms it, and does not send a confirmation email.

Because students do not provide an email or phone number, normal self-service password recovery is unavailable. A forgotten password must be reset by an administrator.

## Calls

Call invitations and WebRTC connection data use the existing Supabase backend with Row Level Security. The actual microphone/camera media is sent peer-to-peer with WebRTC and is not saved as a chat message or video recording.

Vercel serves the site over HTTPS, which is required for browser camera/microphone access. The browser will ask each student for camera/microphone permission when they place or accept a call.

This build uses STUN for peer-to-peer NAT traversal. Most normal home/mobile networks should work, but a restrictive school or enterprise firewall can block direct WebRTC. If that happens, add a school-approved TURN relay for reliable calling on that network.

## Delete chat behavior

Deleting a chat clears the visible history only for the user who deletes it. The friend remains on the friends list, and new messages continue normally.

## Security

The frontend contains only the Supabase publishable key, never the service-role/secret key. Database rows, call signaling, and private image storage use Row Level Security policies.
