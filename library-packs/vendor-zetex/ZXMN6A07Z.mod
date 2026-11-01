*
*Zetex ZXMN6A07Z Spice Model v1.0 Last Revised 29/6/05
*              
.SUBCKT ZXMN6A07Z 30 40 50
*----connections-----D_G_S
M1 6 2 5 5 Nmod L=.6E-6 W=0.34
M2 5 2 5 6 Pmod L=.6E-6 W=0.24
RG 4 2 4
RIN 2 5 1E12
RD 3 6 Rmod1 0.12
RL 6 5 10E9
C1 2 5 25E-12
C2 3 4 15E-12
D1 5 3  Dbodymod
LD 3 30 0.6E-9
LG 4 40 2.0E-9
LS 5 50 2.0E-9
.MODEL Nmod NMOS (LEVEL=3 TOX=85E-9 NSUB=1E17 VTO=3.35  XJ=1.6E-6
+KP=9.5E-6 RS=.035 NFS=1.2E12 KAPPA=0.06 UO=650 IS=1E-15 N=10)
.MODEL Pmod PMOS (LEVEL=3 TOX=80E-9 NSUB=1E16 XJ=2.3E-6
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=0.5E-12 RS=.055  TRS1=1.5e-3
+CJO=71e-12  TT=24E-9 BV=66)
.MODEL Rmod1 RES (TC1=7.3e-3 TC2=1.6E-5)
.ENDS ZXMN6A07Z
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
