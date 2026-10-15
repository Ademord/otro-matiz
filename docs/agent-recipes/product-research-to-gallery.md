# Product research to gallery

An agent finds products against hard criteria, verifies each one on its own product page, downloads the photos, writes flat records and renders them into one `gallery.html` with Otro Matiz. The person gets a single file with ranked cards, specifications, both delivery routes and a link to every shop page.

The worked example is a search for a leather backpack that fits a 15-inch MacBook Air, bought from Switzerland with an optional German delivery address, run on 2026-10-15. Its records are in [`product-research/records.json`](product-research/records.json) and `tests/agent-recipes.test.cjs` renders them on every test run.

## 1. Pin the criteria before searching

Write the hard criteria down and give every research agent the same list. A candidate fails when any one is not met **or cannot be verified**. From the example:

1. Material: real leather body. Nylon with leather trim, "vegan leather" and canvas fail.
2. Fit: the laptop is 34.04 x 23.76 x 1.15 cm. Accept a brand statement of 15", 15.6" or 16", or a stated pocket of at least 35 x 24.5 cm. A "14-inch" rating fails.
3. Price: at most CHF 400 delivered, by either delivery route.
4. Look: clean business look, discreet branding, an established maker.
5. Stock: in stock now in a plain colour.

Also fix the delivery routes (home address, and any EU address that avoids import handling), the currency per route, the date, and any discount codes the person holds.

## 2. Fan out the research

Split by region or brand list and run the agents in parallel. The brief that worked:

- Repeat the five criteria verbatim and the laptop dimensions.
- "Search snippets are not evidence. Only a fetched product page counts."
- Deliverable: a table of passing candidates with **quoted** material and fit statements, exterior size and weight, current and list price, retailer and URL, shipping to each route with cost and whether VAT and duties are included, branding visibility, stock and colour, plus the URL fetched for fit and the URL fetched for price.
- A second list of near-misses that fail exactly one criterion, naming which. These become the candidates when the person later relaxes a criterion (the example's ceiling moved from CHF 350 to 400 mid-run; the near-miss lists made the update cheap).
- "Do not pad with unverified items. Do not recommend; just report."

When a criterion changes while agents run, send them the update instead of restarting them.

## 3. Verify on the product page

- **Shopify shops** (most brand shops and Wardow): `https://<shop>/products/<handle>.json` returns title, variants with price, `compare_at_price` and `available`, `body_html` with the specification text, and `images` with `variant_ids` so you can pick the photo of the colour you want. `https://<shop>/collections/<handle>/products.json?limit=250` lists a whole brand or category; filter it for the laptop rating and material in `body_html`.
- **Other shops**: download the page with `curl -sS -L -A '<browser user agent>' -o page.html <url>` into a scratch folder, strip tags and grep for the specification labels (`Laptopfach`, `Maße`, `Gewicht`, `laptopvak`, `Poche ordinateur`, ...). The `og:image` meta tag gives the main photo.
- If a fetch tool returns HTTP 429, switch to `curl`; do not wait it out.
- **Look at the photos.** Product text rarely describes branding or silhouette. Download the main image and view it before calling a bag "discreet". In the example this separated a classic business bag from a technical one of the same brand, and showed that a "leather" backpack had a fabric body with leather panels (the materials section confirmed it).
- **Fit math.** Compare the laptop's length and width to the stated pocket. A pocket of 35.0 x 24.0 cm against a 34.04 x 23.76 cm laptop is a 2.4 mm margin on width; say so on the card. When the brand states only an inch rating, a 15.6" or 16" rating covers a 15" MacBook Air; a 14" rating does not.
- **Landed cost per route.** Record the shop's own shipping statement verbatim: "free shipping, VAT and duties included" is different from "free shipping" to a non-EU country, where import VAT and a carrier fee arrive on delivery. A brand's own shop in the destination country (stock in-country, free returns) is worth more than a slightly lower foreign price when the fit is tight.

## 4. Write the records

One flat JSON array, one object per product. Every field is a scalar; every field that is not a role becomes a specification on the card, so name fields the way you want them read. Fields used in the example:

| Field | Role | Content |
|---|---|---|
| `id` | id | Stable slug, letters, digits, `-` |
| `rank` | spec | 1 for the first pick; the gallery keeps file order, so sort the array by rank |
| `verdict` | spec | "Top pick", "Shortlist, roomier", "Budget option, casual", ... |
| `name` | row | Brand, model, article number, colour |
| `image` | image | `assets/<id>.jpg`, or empty for a pending card |
| `description` | description | Two sentences: why it ranks here and the one caveat |
| `price_switzerland`, `price_germany` | spec | Price per delivery route, with shop, list price when discounted, and what shipping includes |
| `laptop_fit` | spec | The brand's statement, quoted, plus pocket size when stated |
| `dimensions`, `weight`, `material`, `branding` | spec | From the product page; when two sources disagree, show both |
| `availability` | spec | Colours in stock and the check date |
| `shop` | spec | Host of the product page you verified |
| `product_url` | link | Absolute `https` URL of that page |

Keep ruled-out products out of the gallery and explain them in the chat summary instead; the gallery is the shortlist.

## 5. Download the photos

```sh
mkdir -p work/assets
curl -sS -L -A '<browser user agent>' -o work/assets/<id>.jpg '<cdn url>&width=900'
file work/assets/*            # check the real type
```

Shopify CDN URLs accept `&width=900` for a smaller file. Rename each file to its real type (`file` showed JPEG data behind `.webp` names in the example); the renderer accepts PNG, JPEG and WebP only, refuses remote URLs and stops on a missing file. Use only images you may use for the person's private decision file; the gallery is not published.

## 6. Render

```sh
cd work
node <otro-matiz>/scripts/render-gallery.mjs records.json gallery.html \
  --title "Leather backpacks for a 15-inch MacBook Air" \
  --rows-label "Backpacks" \
  --project project.json
# {"html":"gallery.html","bytes":1342425,"options":14,"ready":14,"project":"project.json"}
```

`options` must equal the number of records and `ready` the number of records with a photo. A non-zero exit prints one reason on stderr and writes nothing. `--project` writes the editable project for **Project → Export & import → Import a project** in the app. Limits: 40 rows, 400 cards, 300 MiB.

## 7. Check the file before sending it

A plain `chromium --headless --screenshot` shows blank tiles because the cards lazy-load their images. Use [`product-research/screenshot-gallery.cjs`](product-research/screenshot-gallery.cjs), which scrolls the page, waits for every image to decode and saves a full-page screenshot:

```sh
NODE_PATH=$(npm root -g) node screenshot-gallery.cjs file:///abs/work/gallery.html gallery.png
# {"images":14,"sizes":[[900,1080],[900,900],[900,900]]}
```

It needs the `playwright` package and a Chromium at `/opt/pw-browsers/chromium`; change `executablePath` for another machine. Open the PNG and check that every card shows its photo, its rank and both prices, and that the title is right.

## 8. Deliver and summarise

Send `gallery.html` (and `project.json` if the person may edit the project). In chat, give the ranked shortlist in a short table with the verified fit statement and the price per route, name the pick and the reason, list the ruled-out products with the criterion they failed, and note the check date. Prices and stock move; say that a re-check is needed before buying if days have passed.

## 9. Re-run later

Keep `records.json` and `assets/` in the private work folder. A re-run only refreshes the price, availability and verdict fields and renders again with the same command.

## Lessons from the worked example

- A retailer that prices the destination country all-in (Wardow CH: "Kostenloser Versand inkl. MwSt. & Zölle") can beat the brand's own shop even at a higher sticker price once import handling is counted.
- Some EU brand shops do not ship to Switzerland at all (Castelijn & Beerens); the German address route is what makes them candidates.
- A brand shop with in-country stock and free returns (braun-bueffel.ch) is the safe route for a bag whose laptop claim is tight for its shell size.
- Brand "15-inch" claims are not pocket measurements. One official page gave a maximum laptop length of 34 cm against a 34.04 cm laptop; that is a fail, not a fit.
- UK and US direct-to-consumer leather makers were all over the ceiling once shipping and import handling were added; do not spend a full agent on that region for a sub-CHF-400 budget.
- Looking at the photo caught a "leather" backpack whose body is recycled-PET fabric and a suede utility rucksack sold as a business bag.
