# Bento card covers

Drop a file here named after the card and it replaces that card's drawn
graphic. Nothing else to change; a missing file falls through to the drawing,
so these can arrive one at a time.

    video.jpg     image.jpg     voice.jpg     effects.jpg
    academy.jpg   studio.jpg    mcp.jpg

## Shapes

The grid is `lg:h-[610px]`, six rows, 8px gap — so a row is 95px and a card is
198px over two rows, 404 over four, 610 over six. Column width runs 294px at a
1280 viewport to 374px at 1600, so generate to a ratio, not to a pixel size:

| cards                  | ratio | generate at |
| ---------------------- | ----- | ----------- |
| video, image, studio   | 3:4   | 1200×1600   |
| voice, academy, mcp    | 2:1   | 1600×800    |
| effects                | 3:5   | 1200×2000   |

`object-cover` crops the overflow, so the sides go first on the tall cards.

## Safe area

The bottom ~45% of every card is scrim and heading. **Keep the subject in the
top half** or it sits behind the text.

## Palette

Canvas `#0a0c0d`, lime `#C6F52E` as the only colour. No blue, no purple, no
teal — that is what the previous set got wrong.
