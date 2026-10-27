#!/usr/bin/perl
# AWS Football Match Plugin updater (native messaging host com.awsfootball.updater).
# The plugin's "Update" button sends {"cmd":"update"}; this runs the same one-line installer from the
# plugin's own GitHub repo (fixed below, nothing from the message is used) in quiet mode, which replaces
# the extension's files, and answers {"ok", "version"}. {"cmd":"version"} answers the installed version.
use strict; use warnings; use JSON::PP; use Encode qw(decode);
my $REPO = '@REPO@';
my $DEST = '@DEST@';
binmode STDIN; binmode STDOUT; $| = 1;
sub reply { my $j = encode_json($_[0]); print pack("L", length $j) . $j; exit 0; }
my $n = read(STDIN, my $len, 4); reply({ ok => JSON::PP::false, error => "no message" }) unless $n && $n == 4;
read(STDIN, my $body, unpack("L", $len));
my $msg = eval { decode_json($body) } || {};
my $cmd = $msg->{cmd} // "";
sub version { open(my $f, "<", "$DEST/manifest.json") or return undef; local $/; my $m = eval { decode_json(<$f>) } || {}; return $m->{version}; }
if ($cmd eq "version") { reply({ ok => JSON::PP::true, version => version() }); }
if ($cmd eq "update") {
  my $out = `/usr/bin/curl -fsSL "https://raw.githubusercontent.com/$REPO/main/install.sh" | FMH_QUIET=1 /bin/bash 2>&1`;
  my $rc = $? >> 8;
  reply({ ok => ($rc == 0 ? JSON::PP::true : JSON::PP::false), version => version(), log => substr(decode("UTF-8", $out, Encode::FB_DEFAULT), -400) });
}
reply({ ok => JSON::PP::false, error => "unknown command" });
