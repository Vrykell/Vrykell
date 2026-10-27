# Local font resources

Two variable sans families are available for interface text (100–900). Three monospaced families are available for terminal and editor text: the default includes regular (400) and bold (700), Chinese, Latin, box-drawing and prompt symbols; the alternatives include variable weights (200–700 and 100–800). Requested weights outside those ranges select the closest face. Italic text uses synthesis. Emoji and unsupported scripts retain system fallback.

The binaries are losslessly compressed from the upstream files into WOFF2, retaining all glyphs and hinting. The distributed manifest records pinned source URLs, source checksums, conversion versions and asset checksums. The source archive checksum is verified against its release checksum before conversion.

Original notices and redistribution terms are preserved in the licenses for [the default interface face](ui-OFL.txt), [the alternate interface face](interface-alt-OFL.txt), [the default terminal face](terminal-OFL.txt), [the alternate terminal face](alternate-OFL.txt) and [the code face](code-OFL.txt). These resources are embedded in the frontend distribution and do not install fonts into the operating system or request fonts from external servers.

The complete directory must remain below 30,000,000 bytes. Asset integrity, required licenses and the size budget are checked by the font asset unit test. Browser tests verify loaded local faces, mixed-script widths, settings labels and failed-resource recovery.
