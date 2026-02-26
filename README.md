# DispoPlan

Desktop-first Dispositionsboard (Mo–So) mit:

- Wochenboard inkl. automatischer KW-Anlage
- Datenmodell für Touren, Stops, Fahrzeuge, Unternehmer
- Drag & Drop zwischen Tagen/Unternehmern
- Filter (Suche, Status, Unternehmer)
- Farbige Status-Badges
- "Datenbank" für Unternehmer + Kennzeichen (persistiert in `localStorage`)
- Account-Anlage und -Verwaltung
- Freie Felder pro Tour (Stops + Notizen)
- Echtzeit-Aktualisierung zwischen Tabs via `BroadcastChannel`

## Start

```bash
python3 -m http.server 4173
```

Dann im Browser öffnen: `http://localhost:4173`
