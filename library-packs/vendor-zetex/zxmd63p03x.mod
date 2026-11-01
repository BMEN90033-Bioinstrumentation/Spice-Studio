*
*Zetex ZXMD63P03X Spice Model v1.0 Last Revised 18/8/00
*
.SUBCKT ZXMD63P03X 3 4 5
*               D G S
M1 3 2 5 5 M63P03
RG 4 2 18
RL 3 5 1E9
C1 2 5 450E-12
C2 3 2 35E-12
D1 3 5 D63P03
*
.MODEL M63P03 PMOS VTO=-2.32 RS=0.09 RD=0.045 KP=4.2
+CBD=480E-12 LAMBDA=4.9E-3
.MODEL D63P03 D IS=4E-13 N=1.04 IKF=295E-3 RS=94E-3
.ENDS ZXMD63P03X
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
