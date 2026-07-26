# Assets

This book was generated without bundled diagram files. Chapters use HTML comment placeholders of the form:

```html
<!-- VISUAL: short description of the intended diagram -->
```

When you add figures later:

1. Place image files in this directory (PNG or SVG preferred).
2. Replace the matching HTML comment with Markdown image syntax, for example:

```markdown
![Docker client, daemon, and registry](../assets/docker-architecture.png)
*Figure 2.1: The Docker client talks to the daemon, which pulls images from a registry.*
```

From chapter files at the book root, asset paths are `assets/...`. From files under `appendices/`, use `../assets/...`.
