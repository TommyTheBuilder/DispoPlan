# DispoPlan

Desktop-first Dispositionsboard (Mo–So) mit:

- Wochenboard inkl. automatischer KW-Anlage
- Datenmodell für Touren, Stops, Fahrzeuge, Unternehmer
- Drag & Drop zwischen Tagen/Unternehmern
- Filter (Suche, Status, Unternehmer)
- Farbige Status-Badges
- Datenhaltung in PostgreSQL (statt nur `localStorage`)
- Account-Anlage und -Verwaltung
- Freie Felder pro Tour (Stops + Notizen)
- Echtzeit-Aktualisierung zwischen Tabs via `BroadcastChannel`

## Server-Setup für deinen Host

Vorgaben:

- Port: `3004`
- Domain: `test.paletten-ms.de`
- Datenbank: PostgreSQL, DB-Name `dispoplan`

### 1) PostgreSQL vorbereiten

```sql
CREATE DATABASE dispoplan;
```

### 2) App installieren

```bash
cd /workspace/DispoPlan
npm install
```

### 3) Umgebungsvariablen setzen

```bash
export PORT=3004
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD='DEIN_PASSWORT'
export DB_NAME=dispoplan
```

### 4) Starten

```bash
npm start
```

Danach läuft die App auf `http://127.0.0.1:3004`.

## NGINX-Proxy für test.paletten-ms.de

```nginx
server {
    listen 80;
    server_name test.paletten-ms.de;

    location / {
        proxy_pass http://127.0.0.1:3004;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## API-Endpunkte

- `GET /api/health` – DB-Verbindung prüfen
- `GET /api/state` – kompletten Board-State laden
- `PUT /api/state` – kompletten Board-State speichern
