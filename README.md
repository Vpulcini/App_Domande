# Carte domande – CdG

Pagina web per telefono che pesca a caso una domanda da tre mazzi (Leggero, Medio, Personale) per lo speed date del Consiglio di gruppo. Non usa server, account né tracciamento. Dopo la prima apertura funziona anche offline e si può aggiungere alla schermata Home.

## File

| File | A cosa serve |
|---|---|
| `index.html`, `style.css`, `app.js` | la pagina |
| `core.js` | logica: lettura del file, code, aggiornamento |
| `domande.csv` | **le domande**: è l'unico file da modificare |
| `sw.js`, `manifest.webmanifest`, `icons/` | uso offline e icona sulla Home |
| `controllo/` | indirizzo breve per la pagina di controllo |
| `test/`, `tools/`, `package.json` | test e strumenti (non servono online, ma non danno fastidio) |

## Modificare le domande

1. Apri `domande.csv` (Excel, LibreOffice o Blocco note). Prima riga `livello,domanda`, poi una domanda per riga:
   ```
   livello,domanda
   leggero,Qual è il piatto che cucini meglio?
   medio,"Chi ti ha ispirato di più, in ambito scout o fuori?"
   ```
   - Livelli: `leggero`, `medio`, `personale` (maiuscole e spazi non contano).
   - Vanno bene sia la virgola sia il punto e virgola. Se la domanda contiene il separatore, mettila tra virgolette.
   - Le righe vuote vengono ignorate e quelle che iniziano con `//` sono commenti. I doppioni nello stesso mazzo vengono tolti.
   - Da Excel puoi salvare come "CSV UTF-8" oppure come "CSV (delimitato dal separatore di elenco)": l'app legge entrambi.
   - In alternativa puoi scrivere un elenco semplice, con le righe `# Leggero`, `# Medio`, `# Personale` come titoli e una domanda per riga sotto ciascuno.
2. Controlla il file prima di pubblicarlo: apri `/controllo` sull'app pubblicata e, in fondo alla pagina, usa "Prova un altro file". Vedrai le domande lette per mazzo e gli eventuali errori con il numero di riga.
3. Ripubblica (vedi sotto). Non serve toccare il codice.

**Se cambi le domande a metà serata:** ogni telefono applica il nuovo elenco alla prossima apertura, oppure subito con Menu (⋯) → "Aggiorna domande". Le domande già uscite non ricompaiono, quelle tolte spariscono e quelle nuove si mescolano tra le carte non ancora estratte.

## Pubblicare

Serve un hosting con HTTPS, necessario per l'uso offline e per tenere lo schermo acceso. Pubblica **solo i file dell'app** elencati sopra: altri file presenti nella cartella (per esempio PDF) diventerebbero pubblici.

### GitHub Pages (consigliato, gratuito)
1. Crea un repository su github.com (anche privato, se hai un piano che lo consente; altrimenti pubblico).
2. "Add file" → "Upload files" e trascina i file dell'app e le cartelle `icons/` e `controllo/`. Poi "Commit changes".
3. Settings → Pages → Source: "Deploy from a branch", branch `main`, cartella `/ (root)` → Save.
4. Dopo un minuto l'app è su `https://<utente>.github.io/<repository>/`.

**Per ripubblicare dopo una modifica:** apri `domande.csv` nel repository → matita (Edit) oppure "Add file" → "Upload files" con il nuovo file → "Commit changes". In 1–2 minuti è online.

### Netlify (alternativa)
Vai su app.netlify.com/drop e trascina una cartella che contiene **solo** i file dell'app. Per ripubblicare: nel sito → "Deploys" → trascina di nuovo la cartella aggiornata.

## Prima della serata
- Su ogni telefono apri l'indirizzo una volta con la connessione: da quel momento funziona anche senza rete.
- Facoltativo: aggiungilo alla Home (Safari: Condividi → "Aggiungi alla schermata Home"; Chrome: ⋮ → "Aggiungi a schermata Home").
- Per ripartire da zero su un telefono: Menu (⋯) → "Azzera questo telefono".
- "Importa domande" nel menu serve per una prova veloce: le domande restano solo su quel telefono, finché non scegli "Torna al file condiviso".

## Modifiche al codice
Se cambi `app.js`, `core.js`, `style.css` o `index.html`, aumenta la versione sia in `core.js` (`VERSION`) sia in `sw.js` (`VERSION`), tenendole uguali: così i telefoni scaricano la nuova versione. Per `domande.csv` non serve.

## Prove in locale
Serve Node.js (nessuna dipendenza da installare):
```
npm test          # test del parser, delle code e dell'aggiornamento
npm start         # app su http://localhost:8080
npm run icons     # rigenera le icone PNG
```
