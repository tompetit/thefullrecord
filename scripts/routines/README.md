# Routines

## openstates-daily.sh — state legislative votes, a little every day

The free Open States key allows 250 requests/day (the API says so when exceeded:
`exceeded limit of 250/day`). This routine spends up to 200 of them daily
(`BUDGET`), ingesting never-attempted states first and then refreshing the
stalest ones, commits the snapshots to `data/openstates-daily`, and keeps one PR
open. Needs `OPENSTATES_API_KEY` in `~/thefullrecord/.env.local` and an
authenticated `gh`.

Installed on the dev box as a systemd user timer (00:30 UTC daily):

    ~/.config/systemd/user/openstates-daily.service
    ~/.config/systemd/user/openstates-daily.timer
    sudo loginctl enable-linger ec2-user   # run without an open session

Check / run by hand / stop:

    systemctl --user list-timers openstates-daily.timer
    journalctl --user -u openstates-daily.service -n 50
    systemctl --user start openstates-daily.service
    systemctl --user disable --now openstates-daily.timer
