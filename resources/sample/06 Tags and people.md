# Tags and people

A tag is a word after a hash. It exists the moment it is written; there is
no list to add it to first. A tag with a slash is **namespaced**: the part
before the slash says what kind of thing it names. This sample uses a few
namespaces:

```text
#person/sable-ortiz      people                 #team/wardens            teams
#project/ghostline-relay  projects             #contact/praxis-loom     people outside the teams
#location/south-spindle   places               #context/phone           where a task can be done
#status/doing             a task's status      #risk/workload           what could go wrong
```

A tag on a heading covers everything under it. A tag on a line covers that
line. A tag in a note's front matter covers the whole note. Search for a tag
and you get every entry that carries it, whichever way.

## Harbor check-in #team/harbor

Sable took the clinic lead while Kenji covered the flooded east exits, and
the two of them will meet the dawn team at South Spindle.

### Sable Ortiz #person/sable-ortiz
Sable will review the clinic's consent language with #contact/dr-yara-quell
and keep patient identifiers out of the case ledger.

### Kenji Rook #person/kenji-rook
Kenji mapped three places where the rainshadow mesh thins out for less than
a second, and will time them again in the evening rush.
Kenji will keep the #location/east-exits map current and tell #person/sable-ortiz
when the medical route floods.

## What to notice

Two things above are there on purpose:

- The Kenji paragraph names the mesh survey project in plain words, without
  its tag. A tag's page counts entries like that, so you can tag them.
- One of the daily notes spells Mara Vale's tag with a letter missing. Stats
  and Home both notice, and offer to merge it into the right one.

## Hub notes

A **hub note** says what a tag is about. Its front matter names the tag with
`describes:`, and the tag's page opens with it at the top, its other
front-matter fields shown as properties. This sample has five: Sable Ortiz
in the people folder, Harbor and Wardens in the teams folder, and Argent
Protocol and Ghostline Relay in the projects folder.

The Ashen Mirror project is written about in several daily notes but has no
hub, so Home's **Tags without a hub** widget lists it, with **Create hub**.

## Hubs, and where a note sits

The **Hubs** view in the Deckard sidebar is a tree of the topics that have a
hub note, each with the notes about it filed underneath:

```text
People
  Sable Ortiz
Projects
  Argent Protocol            1 of 3 done
  Ghostline Relay            3 of 23 done
    Receiver firmware
      Firmware bench log
    Relay route survey
Teams
  Harbor                     0 of 2 done
  Wardens                    3 of 21 done
```

A note is filed under a hub when its front matter or its first heading
carries the hub's tag: the Relay route survey's front matter names the relay
project. A note can also name its place outright with `up:` in its front
matter. Receiver firmware is a hub of its own whose `up:` names Ghostline
Relay, so it is a sub-project; the Firmware bench log carries no tag at all,
and its `up:` names Receiver firmware.

A line that mentions a tag in passing, as the daily notes do, does not file
its note there. Each hub shows how far along its tag's tasks are, the same
figure its page and its first line in the editor give.

## Try it

1. Cmd/Ctrl-click `#team/harbor` on the Harbor check-in heading. Its page opens
   with the Harbor hub note on top and every Harbor entry beneath it.
2. Hover a tag in the editor. The hover says how many notes and tasks use
   it, names its hub, and lists its latest entries.
3. Run **Deckard: Open a Tag's Search Page…** and choose the mesh survey's
   project tag. Under the title it says how many entries mention its name without
   the tag. Select **Show them**, then **Bulk edit → Add a tag** to tag them.
4. Open the page for `#person/mara-vale`. It says the tag is **also written
   as** `#person/mara-vle`, with **Include in search** and **Merge**. Merge it:
   Deckard shows how many entries each spelling has, previews the change,
   and **Deckard: Undo Last Change** takes it back.
5. Open the page for the Ashen Mirror project and select **Create hub note**.
   It starts from the project template in the templates folder.
6. Right-click any tag on Home's **Tags** tab and choose **Rename tag**. As
   you type, the box says whether the new name is new or merges into a tag
   that exists.
7. On an empty line, type `#ghost`. Completion offers
   `#project/ghostline-relay`, with how many entries use it. Delete the line
   afterward.
8. On Home's **Tags** tab, choose **Namespace → Person** to list only the
   people, busiest first. Home's **Gone quiet** widget, which you can add with
   **Customize → Add widget**, lists the people you have not written about
   for 30 days or more: nobody yet in a sample this new.
9. Expand the **Hubs** view in the Deckard sidebar, then **Ghostline Relay**
   and **Receiver firmware** under it. Select **Firmware bench log**: its
   first line reads *Projects › Ghostline Relay › Receiver firmware ›
   Firmware bench log*, and selecting that opens Receiver firmware.
10. Open the Ghostline Relay note. Its first line says how far along the
    relay's tasks are: *Progress: 3 of 23 done · 2 overdue · 1 needs a new
    date · next due today*. Selecting it opens the tag's page, where the same
    bar sits under the hub with **Show overdue**.
11. Select **Wardens** in the Hubs view: a hub opens its tag's search page.
    The file button beside it (**Open Hub Note**) opens the Wardens note's
    Markdown instead.

Next: [[07 Links]]
