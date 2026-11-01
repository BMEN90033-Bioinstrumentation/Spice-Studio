*
*ZETEX ZXMN3B04N8 Spice Model v2.0 Last Revised 15/3/07
*
.SUBCKT ZXMN3B04N8 30 40 50
*------connections-------D-G-S
M1 6 2 5 5 Nmod L=1.16E-6 W=2.9
M2 5 2 5 6 Pmod L=1.3E-6 W=1.6
RG 4 2 1
RIN 2 5 1E12
RD 3 6 Rdmod 0.01
RL 3 5 3E9
C1 2 5 8.5E-12
C2 3 4 3E-12
D1 5 3  Dbodymod
LD 3 30 1.3E-9
LG 4 40 1.2E-9
LS 5 50 1.2E-9
.MODEL Nmod NMOS (LEVEL=3 TOX=3.7E-8 NSUB=3E17 VTO=1.32
+KP=15E-5 RS=.008 NFS=2E11 KAPPA=0.06 UO=650 IS=1E-15 N=10)
.MODEL Pmod PMOS (LEVEL=3 TOX=5E-8 NSUB=1.5E16
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=1E-11 RS=.01 IKF=.5 TRS1=3e-3
+CJO=85e-12  BV=33)
.MODEL Rdmod RES (TC1=5.2e-3 TC2=1E-5)
.ENDS ZXMN3B04N8
*
*$
*
*                (c)  2007 Zetex Semiconductors plc
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