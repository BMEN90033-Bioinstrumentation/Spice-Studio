*
*Zetex ZVNL110G Spice Model v1.0 Last Revised 19/3/03
*
.SUBCKT ZVNL110G 3 4 5
*               D G S
M1 21 22 23 23 MNL110a
M2 21 22 23 23 MNL110b
RG 4 22 120
RD 3 21 2
RS 5 23 1
RL 3 5 1E9
C1 22 5 55E-12
C2 3 22 5E-12
D1 5 3 DNL110a
*
.MODEL MNL110a NMOS VTO=2.1 IS=1E-15 KP=0.2 CBD=60E-12 PB=1 
+LAMBDA=2.6E-3
.MODEL MNL110b NMOS VTO=0.95 RS=2 Rd=2 KP=0.05 PB=1 LAMBDA=2.6E-3
.MODEL DNL110a D IS=1E-12 RS=0.37 BV=105
.ENDS ZVNL110G
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
