*
*Zetex ZVNL120A Spice Model v1.0 Last Revised 27/9/04
*
.SUBCKT ZVNL120A 3 4 5
*               D G S
M1 21 2 23 23 Mmod1
M2 21 2 23 23 Mmod2
J1 24 25 21 Jmod
RJ 25 23 1000
RG 4 22 90
RD1 3 24 Rmod1 2
RD2 21 24 Rmod1 20
RS 5 23 Rmod1 1
RL 3 5 1.5E9
RIN 22 5 2E9
C1 22 5 85E-12
C2 3 22 7E-12
D1 5 3 Dmod
Igt 5 31 1
Rgt 31 32 Rmod2 1
Vgt 5 32 1
Egt 22 2 5 31 1
.MODEL Mmod1 NMOS VTO=1.7 IS=1E-15 KP=0.5 CBD=20E-12 PB=1 
+LAMBDA=2.6E-3
.MODEL Mmod2 NMOS VTO=0.95 RS=2 Rd=2 KP=0.05 PB=1 LAMBDA=2.6E-3
.MODEL Jmod NJF  Beta=15m Betatce=-.5 Lambda=50m Vto=-6.25 Vtotc=-2.5m 
.MODEL Dmod D IS=1E-12 RS=0.5 BV=205
.MODEL Rmod1 RES (TC1=9e-3 TC2=2.5E-5)
.MODEL Rmod2 RES (TC1=2.4e-3 TC2=1E-6)
.ENDS ZVNL120A
*
*$
*
*                (c)  2005 Zetex Semiconductors plc
*
*   The copyright in these models  and  the designs embodied belong
*   to Zetex Semiconductors plc (" Zetex ").  They  are  supplied
*   free of charge by Zetex for the purpose of research and design
*   and may be used or copied intact  (including this notice)  for
*   that purpose only.  All other rights are reserved. The models
*   are believed accurate but  no condition  or warranty  as to their
*   merchantability or fitness for purpose is given and no liability
*   in respect of any use is accepted by Zetex PLC, its distributors
*   or agents.
*
*   Zetex Semiconductors plc, Zetex Technology Park, Chadderton,
*   Oldham, United Kingdom, OL9 9LL
