# Security notes

- Do not commit `.env` or any real Freshsales credential.
- Rotate the Freshsales API key immediately if it is ever exposed.
- Keep `ALLOW_INSECURE_NOAUTH=false` on every public deployment.
- Use a unique connector passphrase with at least 20 characters.
- Use the ChatGPT permission level **Ask before making changes**.
- Review proposed contact IDs, owner IDs, due dates, and field names before approving writes.
- Back up the OAuth client registration file, but never publish it.
- The connector deliberately provides no delete or email-send tools.
