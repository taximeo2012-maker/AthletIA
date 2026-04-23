import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Needed for receiving OAuth callbacks and sending JSON
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ------------- STRAVA OAUTH ROUTES -------------
  
  // In-memory store for OAuth sessions (Short-polling)
  const oauthSessions = new Map<string, any>();

  // Endpoint to get the Strava OAuth authorization URL
  app.get("/api/auth/strava/url", (req, res) => {
    let origin = String(req.query.origin || process.env.APP_URL || "");
    if (origin.endsWith('/')) origin = origin.slice(0, -1);
    
    const sessionId = req.query.sessionId as string;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    const redirectUri = `${origin}/auth/strava/callback`;
    const clientId = process.env.STRAVA_CLIENT_ID;

    if (!clientId) {
      return res.status(500).json({ error: "STRAVA_CLIENT_ID environment variable is missing" });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "read,activity:read_all", // We need read_all to get private activities
      approval_prompt: "force",
      state: sessionId
    });

    const authUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;
    res.json({ url: authUrl });
  });

  // Callback handler to exchange authorization code for an access token
  app.get(["/auth/strava/callback", "/auth/strava/callback/"], async (req, res) => {
    const { code, error, state } = req.query;

    if (error) {
      return res.send(`
        <html><body style="font-family:sans-serif; text-align:center; padding: 2rem;">
          <h2>Erreur d'authentification</h2>
          <p>${error}</p>
          <p>Vous pouvez fermer cette fenêtre.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body></html>
      `);
    }

    if (!code || !state) {
      return res.status(400).send("No code or state provided.");
    }

    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).send("Strava configuration is missing.");
    }

    try {
      // Exchange code for token
      const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code: code.toString(),
          grant_type: "authorization_code"
        })
      });

      if (!tokenResponse.ok) {
        const errDetails = await tokenResponse.text();
        console.error("Strava Token Error Details:", errDetails);
        throw new Error(`Failed to exchange code. Status: ${tokenResponse.status}`);
      }

      const tokenData = await tokenResponse.json();
      
      // Store the token in the session map
      oauthSessions.set(state.toString(), tokenData);
      
      res.send(`
        <html>
          <body style="font-family:sans-serif; text-align:center; padding: 2rem; background: #fdfdfd;">
            <div style="background: #e6fae6; color: #1e7e34; padding: 1rem; border-radius: 8px; display: inline-block; max-width: 400px;">
                <h2 style="margin-top:0;">Connecté à Strava !</h2>
                <p>Authentification réussie. Tu peux fermer cette fenêtre et retourner sur AthletIA.</p>
            </div>
            <script>
              // Try to close automatically
              window.close();
            </script>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('Strava callback error:', err);
      res.status(500).send("Failed to exchange Strava code for token. " + (err instanceof Error ? err.message : String(err)));
    }
  });

  // Polling endpoint for the client to retrieve their tokens
  app.get("/api/auth/strava/poll", (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    if (oauthSessions.has(sessionId)) {
      const data = oauthSessions.get(sessionId);
      oauthSessions.delete(sessionId); // Clean up immediately after consumption
      return res.json({ success: true, payload: data });
    } else {
      return res.json({ success: false, pending: true });
    }
  });


  // API proxy endpoint to fetch Strava activities using the client's token
  // To avoid exposing the Strava secret further, any token refreshes can happen here too if needed,
  // but for simplicity we will accept the token from the client for this endpoint.
  app.get("/api/strava/activities", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No authorization header" });

    try {
      const stravaRes = await fetch("https://www.strava.com/api/v3/athlete/activities", {
        headers: { Authorization: authHeader }
      });
      if (!stravaRes.ok) throw new Error("Failed to fetch activities");
      const data = await stravaRes.json();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch activities from Strava" });
    }
  });


  // ------------- GOOGLE FIT OAUTH ROUTES -------------
  
  // Endpoint to get the Google Fit OAuth authorization URL
  app.get("/api/auth/google/url", (req, res) => {
    let origin = String(req.query.origin || process.env.APP_URL || "");
    if (origin.endsWith('/')) origin = origin.slice(0, -1);
    
    const sessionId = req.query.sessionId as string;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    const redirectUri = `${origin}/api/auth/google/callback`;
    const clientId = process.env.GOOGLE_FIT_CLIENT_ID;

    if (!clientId) {
      return res.status(500).json({ error: "GOOGLE_FIT_CLIENT_ID environment variable is missing" });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/fitness.activity.read https://www.googleapis.com/auth/fitness.heart_rate.read https://www.googleapis.com/auth/fitness.location.read",
      access_type: "offline",
      prompt: "consent",
      state: sessionId
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.json({ url: authUrl });
  });

  // Callback handler for Google Fit
  app.get(["/api/auth/google/callback", "/api/auth/google/callback/"], async (req, res) => {
    const { code, error, state } = req.query;

    if (error) {
      return res.send(`
        <html><body style="font-family:sans-serif; text-align:center; padding: 2rem;">
          <h2>Erreur d'authentification Google</h2>
          <p>${error}</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body></html>
      `);
    }

    if (!code || !state) return res.status(400).send("No code or state provided.");

    const clientId = process.env.GOOGLE_FIT_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_FIT_CLIENT_SECRET;
    
    // Fallback origin
    const origin = process.env.APP_URL || `https://${req.headers.host}`;
    const redirectUri = `${origin}/api/auth/google/callback`;

    if (!clientId || !clientSecret) return res.status(500).send("Google Fit configuration is missing.");

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: code.toString(),
          grant_type: "authorization_code",
          redirect_uri: redirectUri
        })
      });

      if (!tokenResponse.ok) {
        const errDetails = await tokenResponse.text();
        console.error("Google Token Error:", errDetails);
        throw new Error(`Failed to exchange code. Status: ${tokenResponse.status}`);
      }

      const tokenData = await tokenResponse.json();
      oauthSessions.set(state.toString(), tokenData); // On réutilise le même store temporaire que Strava
      
      res.send(`
        <html>
          <body style="font-family:sans-serif; text-align:center; padding: 2rem; background: #fdfdfd;">
            <div style="background: #e6fae6; color: #1e7e34; padding: 1rem; border-radius: 8px; display: inline-block;">
                <h2 style="margin-top:0;">Connecté à Google Fit !</h2>
                <p>Authentification réussie. Tu peux fermer cette fenêtre.</p>
            </div>
            <script>window.close();</script>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('Google callback error:', err);
      res.status(500).send("Failed to exchange Google code for token.");
    }
  });

  // Proxy to fetch Google Fit Datasets
  app.post("/api/googlefit/dataset", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No authorization header" });

    // Request body should contain time ranges and dataTypeName
    try {
      const fitRes = await fetch("https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate", {
        method: "POST",
        headers: { 
          "Authorization": authHeader,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(req.body)
      });
      if (!fitRes.ok) throw new Error("Failed to fetch from Google Fit");
      const data = await fitRes.json();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch from Google Fit API" });
    }
  });


  // ------------- VITE MIDDLEWARE -------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Note: if you plan to build this, make sure dist exists and compile server.ts if needed
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
