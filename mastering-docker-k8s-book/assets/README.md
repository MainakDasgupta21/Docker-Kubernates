# Assets

PNG illustrations for chapter-opening analogies and the book cover. Technical architecture and flow diagrams are **Mermaid** blocks inside the Markdown chapters (they render on GitHub).

## Inventory

| File | Used for |
|------|----------|
| `cover-mastering-docker-k8s.png` | Book cover (README) |
| `analogy-shipping-containers.png` | Preface, Chapter 01 |
| `analogy-restaurant-kitchen.png` | Chapter 02 |
| `analogy-skyscraper-layers.png` | Chapter 03 |
| `analogy-apartment-building.png` | Chapter 06 |
| `analogy-whiteboard-filing.png` | Chapter 07 |
| `analogy-orchestra.png` | Chapter 08 |
| `analogy-restaurant-chain.png` | Chapter 09 |
| `analogy-hotel-room.png` | Chapter 10 |
| `analogy-shipping-port.png` | Chapter 11 |
| `analogy-hotel-minibar.png` | Chapter 18 |
| `analogy-city-grid.png` | Chapter 19 |
| `analogy-concert-seating.png` | Chapter 20 |
| `analogy-keys-badges.png` | Chapter 21 |
| `analogy-instrument-panel.png` | Chapter 22 |
| `analogy-flatpack-furniture.png` | Chapter 23 |
| `analogy-airline-ops.png` | Chapter 24 |

## Embedding

From chapter files at the book root:

```markdown
![Alt text](assets/filename.png)

*Figure NN.A: Caption.*
```

From `appendices/`, use `../assets/filename.png`.

See [Appendix H — Figure Index](../appendices/h-figure-index.md) for the full list of Mermaid figures and illustrations.
