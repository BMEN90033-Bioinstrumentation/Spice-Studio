*
*Zetex ZXMN2A02N8 Spice Model v2.0 Last Revised 22/2/05
*
.SUBCKT ZXMN2A02N8 30 40 50
*---connections---D-G-S
M1 6 2 7 7 Nmod L=1.16E-6 W=2.3
M2 7 2 7 6 Pmod L=1.3E-6 W=1.3
RG 4 2 1
RIN 2 5 1E12
RD 3 6 Rdmod 0.0045
RS 7 5 Rdmod 0.01
RL 3 5 3E9
C1 2 5 10E-12
C2 3 2 5E-12
D1 5 3  Dbodymod
LD 3 30 1.3E-9
LG 4 40 1.2E-9
LS 5 50 1.2E-9
.MODEL Nmod NMOS (LEVEL=3 TOX=4.5E-8 NSUB=10E16
+VTO=1.365 KP=3.6E-5 NFS=2E11 KAPPA=0.1 UO=650 IS=1E-15 N=10)
.MODEL Pmod PMOS (LEVEL=3 TOX=4.5E-8 NSUB=1.5E16
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=2E-11 RS=.015 XTI=1.5 TRS1=1.5e-3 TT=7e-9
+CJO=450e-12 BV=22)
.MODEL Rdmod RES (TC1=3e-3 TC2=6E-6)
.ENDS
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
